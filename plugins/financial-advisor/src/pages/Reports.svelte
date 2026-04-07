<script lang="ts">
  import { onMount } from 'svelte';
  import { Select, Table } from '@plures/design-dojo';
  import { getPluginContext } from '../lib/context.js';
  import {
    FA_TRANSACTIONS_COLLECTION,
    FA_INFERENCES_COLLECTION,
    type Transaction,
    type TransactionInference,
  } from '../lib/transactions.js';
  import { FA_BUDGETS_COLLECTION, monthLabel, type Budget } from '../lib/budgets.js';

  type PluginContext = NonNullable<ReturnType<typeof getPluginContext>>;
  type CollectionOf<T> = ReturnType<PluginContext['data']['collection']<T>>;

  interface MonthSummary {
    prefix: string;
    label: string;
    income: number;
    expenses: number;
    byCategory: Record<string, number>;
  }

  interface CategoryStat {
    category: string;
    total: number;
    color: string;
  }

  interface VarianceRow {
    category: string;
    budgeted: number;
    actual: number;
    isOver: boolean;
  }

  interface PieSliceData {
    path: string;
    color: string;
    category: string;
    total: number;
  }

  let ctx: ReturnType<typeof getPluginContext>;
  let txCollection: CollectionOf<Transaction>;
  let infCollection: CollectionOf<TransactionInference>;
  let budgetCollection: CollectionOf<Budget>;

  // ── State ─────────────────────────────────────────────────────────────────
  let loading = $state(true);
  let transactions = $state<Transaction[]>([]);
  let inferences = $state<TransactionInference[]>([]);
  let budgets = $state<Budget[]>([]);
  let periodMonths = $state(6);

  // ── Category color palette ─────────────────────────────────────────────────
  const CAT_COLORS = [
    '#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ef4444',
    '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#06b6d4',
    '#84cc16', '#a855f7', '#0ea5e9', '#10b981', '#f43f5e',
  ] as const;

  // SVG chart geometry — shared for line / bar charts
  const C_X0 = 60, C_X1 = 500, C_Y0 = 15, C_Y1 = 165;
  // Donut chart geometry
  const PIE_CX = 100, PIE_CY = 100, PIE_R = 82, PIE_RI = 48;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getMonthPrefixes(count: number): string[] {
    const result: string[] = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return result;
  }

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  const fmt = (n: number) => currencyFormatter.format(n);
  function buildPieSlicePath(startAngle: number, endAngle: number): string {
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1 = PIE_CX + PIE_R * Math.cos(startAngle);
    const y1 = PIE_CY + PIE_R * Math.sin(startAngle);
    const x2 = PIE_CX + PIE_R * Math.cos(endAngle);
    const y2 = PIE_CY + PIE_R * Math.sin(endAngle);
    const ix1 = PIE_CX + PIE_RI * Math.cos(endAngle);
    const iy1 = PIE_CY + PIE_RI * Math.sin(endAngle);
    const ix2 = PIE_CX + PIE_RI * Math.cos(startAngle);
    const iy2 = PIE_CY + PIE_RI * Math.sin(startAngle);
    return (
      `M ${x1} ${y1} A ${PIE_R} ${PIE_R} 0 ${large} 1 ${x2} ${y2} ` +
      `L ${ix1} ${iy1} A ${PIE_RI} ${PIE_RI} 0 ${large} 0 ${ix2} ${iy2} Z`
    );
  }

  // ── Derived: category-inference lookup map ─────────────────────────────────
  const catMap = $derived(
    new Map<string, string>(
      inferences
        .filter(inf => inf.field === 'category' && typeof inf.value === 'string')
        .map(inf => [inf.transactionId, inf.value as string]),
    ),
  );

  const monthPrefixes = $derived(getMonthPrefixes(periodMonths));

  const monthlySummariesByPrefix = $derived(
    (() => {
      const summaries = new Map<
        string,
        { income: number; expenses: number; byCategory: Record<string, number> }
      >();

      for (const tx of transactions) {
        const prefix = tx.date.slice(0, 7);
        let summary = summaries.get(prefix);

        if (!summary) {
          summary = { income: 0, expenses: 0, byCategory: {} };
          summaries.set(prefix, summary);
        }

        if (tx.amount > 0) {
          summary.income += tx.amount;
        } else {
          const spend = Math.abs(tx.amount);
          summary.expenses += spend;
          const cat = catMap.get(tx.id);
          if (cat && cat !== 'Income' && cat !== 'Transfer' && cat !== 'Refund') {
            summary.byCategory[cat] = (summary.byCategory[cat] ?? 0) + spend;
          }
        }
      }

      return summaries;
    })(),
  );

  // ── Derived: per-month income / expense / by-category breakdown ────────────
  const monthlyData = $derived(
    monthPrefixes.map((prefix): MonthSummary => {
      const summary = monthlySummariesByPrefix.get(prefix);
      return {
        prefix,
        label: monthLabel(prefix),
        income: summary?.income ?? 0,
        expenses: summary?.expenses ?? 0,
        byCategory: summary ? { ...summary.byCategory } : {},
      };
    }),
  );

  // ── Derived: aggregate spending by category (across the whole period) ───────
  const spendByCategory = $derived<CategoryStat[]>(
    (() => {
      const totals: Record<string, number> = {};
      for (const m of monthlyData) {
        for (const [cat, amt] of Object.entries(m.byCategory)) {
          totals[cat] = (totals[cat] ?? 0) + amt;
        }
      }
      return Object.entries(totals)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([category, total], i): CategoryStat => ({
          category,
          total,
          color: CAT_COLORS[i % CAT_COLORS.length],
        }));
    })(),
  );

  const totalSpend = $derived(spendByCategory.reduce((s, c) => s + c.total, 0));
  const totalIncome = $derived(monthlyData.reduce((s, m) => s + m.income, 0));
  const totalExpenses = $derived(monthlyData.reduce((s, m) => s + m.expenses, 0));
  const netCashFlow = $derived(totalIncome - totalExpenses);

  // Top 5 spending categories drive the trend line chart
  const topCategories = $derived(spendByCategory.slice(0, 5));

  // ── Derived: donut chart slices ────────────────────────────────────────────
  const pieSlices = $derived<PieSliceData[]>(
    (() => {
      if (totalSpend === 0 || spendByCategory.length === 0) return [];
      let angle = -Math.PI / 2; // start at 12 o'clock
      const slices: PieSliceData[] = [];
      for (let i = 0; i < spendByCategory.length; i++) {
        const cat = spendByCategory[i];
        // Guard against degenerate full-circle arc (SVG limitation when start === end)
        const sliceAngle =
          spendByCategory.length === 1
            ? 2 * Math.PI - 0.001
            : (cat.total / totalSpend) * 2 * Math.PI;
        const endAngle = angle + sliceAngle;
        slices.push({
          path: buildPieSlicePath(angle, endAngle),
          color: CAT_COLORS[i % CAT_COLORS.length],
          category: cat.category,
          total: cat.total,
        });
        angle = endAngle;
      }
      return slices;
    })(),
  );

  // ── Derived: budget variance (current-month actual vs budget limit) ─────────
  const budgetVariance = $derived<VarianceRow[]>(
    (() => {
      if (monthlyData.length === 0 || budgets.length === 0) return [];
      const current = monthlyData[monthlyData.length - 1];
      return budgets
        .map(
          (b): VarianceRow => ({
            category: b.category,
            budgeted: b.monthlyLimit,
            actual: current.byCategory[b.category] ?? 0,
            isOver: (current.byCategory[b.category] ?? 0) > b.monthlyLimit,
          }),
        )
        .sort((a, b) => b.actual - a.actual)
        .slice(0, 10);
    })(),
  );

  // ── Derived: spending-trends line chart ────────────────────────────────────
  const lineChartData = $derived(
    (() => {
      const n = monthlyData.length;
      if (n === 0 || topCategories.length === 0) return null;

      let maxVal = 0;
      for (const cat of topCategories) {
        for (const m of monthlyData) {
          const v = m.byCategory[cat.category] ?? 0;
          if (v > maxVal) maxVal = v;
        }
      }
      if (maxVal === 0) return null;

      const xOf = (i: number) =>
        C_X0 + (n <= 1 ? (C_X1 - C_X0) / 2 : (i / (n - 1)) * (C_X1 - C_X0));
      const yOf = (v: number) => C_Y1 - (v / maxVal) * (C_Y1 - C_Y0);

      const lines = topCategories.map(cat => ({
        color: cat.color,
        category: cat.category,
        points: monthlyData
          .map((m, i) => `${xOf(i)},${yOf(m.byCategory[cat.category] ?? 0)}`)
          .join(' '),
        dots: monthlyData.map((m, i) => ({
          cx: xOf(i),
          cy: yOf(m.byCategory[cat.category] ?? 0),
          value: m.byCategory[cat.category] ?? 0,
        })),
      }));

      const yTicks = Array.from({ length: 5 }, (_, i) => ({
        y: yOf((maxVal / 4) * i),
        label: fmt((maxVal / 4) * i),
      }));

      const monthParts = monthlyData.map(m => m.label.split(' '));
      const monthCounts = monthParts.reduce(
        (counts, parts) => {
          const month = parts[0] ?? '';
          counts.set(month, (counts.get(month) ?? 0) + 1);
          return counts;
        },
        new Map<string, number>(),
      );
      const useYearSuffix = Array.from(monthCounts.values()).some(count => count > 1);

      const xLabels = monthlyData.map((m, i) => {
        const [month, year] = m.label.split(' ');
        const shortYear = year ? `'${year.slice(-2)}` : '';

        return {
          x: xOf(i),
          label: useYearSuffix && shortYear ? `${month} ${shortYear}` : month,
        };
      });
      return { lines, yTicks, xLabels };
    })(),
  );

  // ── Derived: budget-variance bar chart ────────────────────────────────────
  const varianceChartData = $derived(
    (() => {
      if (budgetVariance.length === 0) return null;
      const maxVal = Math.max(
        ...budgetVariance.flatMap(r => [r.budgeted, r.actual]),
        1,
      );
      const n = budgetVariance.length;
      const groupW = (C_X1 - C_X0) / n;
      const barW = Math.min(groupW * 0.35, 22);
      const gap = 2;
      const chartH = C_Y1 - C_Y0;
      const yOf = (v: number) => C_Y1 - (v / maxVal) * chartH;

      const bars = budgetVariance.map((row, i) => {
        const gx = C_X0 + i * groupW + groupW / 2;
        return {
          category: row.category,
          budgeted: row.budgeted,
          actual: row.actual,
          budgetedRect: {
            x: gx - barW - gap / 2,
            y: yOf(row.budgeted),
            width: barW,
            height: (row.budgeted / maxVal) * chartH,
          },
          actualRect: {
            x: gx + gap / 2,
            y: yOf(row.actual),
            width: barW,
            height: (row.actual / maxVal) * chartH,
          },
          isOver: row.isOver,
          labelX: gx,
          labelText:
            row.category.length > 7 ? row.category.slice(0, 6) + '…' : row.category,
        };
      });

      const yTicks = Array.from({ length: 5 }, (_, i) => ({
        y: yOf((maxVal / 4) * i),
        label: fmt((maxVal / 4) * i),
      }));

      return { bars, yTicks };
    })(),
  );

  // ── Derived: cash-flow bar chart ───────────────────────────────────────────
  const cashFlowChartData = $derived(
    (() => {
      if (monthlyData.length === 0) return null;
      const maxVal = Math.max(
        ...monthlyData.flatMap(m => [m.income, m.expenses]),
        1,
      );
      const n = monthlyData.length;
      const groupW = (C_X1 - C_X0) / n;
      const barW = Math.min(groupW * 0.35, 22);
      const gap = 2;
      const chartH = C_Y1 - C_Y0;
      const yOf = (v: number) => C_Y1 - (v / maxVal) * chartH;
      const monthTokenCounts = monthlyData.reduce((counts, m) => {
        const monthToken = m.label.split(' ')[0];
        counts.set(monthToken, (counts.get(monthToken) ?? 0) + 1);
        return counts;
      }, new Map<string, number>());

      const groups = monthlyData.map((m, i) => {
        const gx = C_X0 + i * groupW + groupW / 2;
        const monthToken = m.label.split(' ')[0];
        return {
          labelX: gx,
          label: (monthTokenCounts.get(monthToken) ?? 0) > 1 ? m.label : monthToken,
          income: m.income,
          expenses: m.expenses,
          incomeRect: {
            x: gx - barW - gap / 2,
            y: yOf(m.income),
            width: barW,
            height: (m.income / maxVal) * chartH,
          },
          expRect: {
            x: gx + gap / 2,
            y: yOf(m.expenses),
            width: barW,
            height: (m.expenses / maxVal) * chartH,
          },
          net: m.income - m.expenses,
        };
      });

      const yTicks = Array.from({ length: 5 }, (_, i) => ({
        y: yOf((maxVal / 4) * i),
        label: fmt((maxVal / 4) * i),
      }));

      return { groups, yTicks };
    })(),
  );

  // ── Load data on mount ─────────────────────────────────────────────────────
  onMount(() => {
    ctx = getPluginContext();
    txCollection = ctx?.data.collection<Transaction>(FA_TRANSACTIONS_COLLECTION);
    infCollection = ctx?.data.collection<TransactionInference>(FA_INFERENCES_COLLECTION);
    budgetCollection = ctx?.data.collection<Budget>(FA_BUDGETS_COLLECTION);
    loadAll();
  });

  async function loadAll(): Promise<void> {
    loading = true;
    try {
      const [txData, infData, budgetData] = await Promise.all([
        txCollection?.query() ?? Promise.resolve([] as Transaction[]),
        infCollection?.query({ field: 'category' }) ??
          Promise.resolve([] as TransactionInference[]),
        budgetCollection?.query() ?? Promise.resolve([] as Budget[]),
      ]);
      transactions = txData;
      inferences = infData;
      budgets = budgetData;
    } catch {
      ctx?.notify.error('Failed to load report data.');
    } finally {
      loading = false;
    }
  }
</script>

<!-- ── Page ──────────────────────────────────────────────────────────────────── -->
<div class="reports-page">

  <!-- Header -->
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">Reports</h1>
      <p class="page-header__subtitle">
        {#if !loading}
          {transactions.length} transactions analyzed
        {:else}
          Loading…
        {/if}
      </p>
    </div>

    {#if !loading}
      <div class="period-selector">
        <label class="period-selector__label" for="period-select">Period</label>
        <Select
          id="period-select"
          class="field__select period-selector__select"
          bind:value={periodMonths}
          aria-label="Select reporting period"
        >
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
        </Select>
      </div>
    {/if}
  </header>

  {#if loading}
    <!-- ── Skeleton loader ─────────────────────────────────────────────────── -->
    <div class="skeleton-list" aria-busy="true" aria-label="Loading reports">
      {#each [1, 2, 3, 4] as _}
        <div class="skeleton-card"></div>
      {/each}
    </div>

  {:else}
    <!-- ── Summary stats ───────────────────────────────────────────────────── -->
    <div class="stats-row" aria-label="Period summary">
      <div class="stat-card">
        <span class="stat-card__label">Total Income</span>
        <span class="stat-card__value stat-card__value--income">{fmt(totalIncome)}</span>
        <span class="stat-card__sub">last {periodMonths} months</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">Total Expenses</span>
        <span class="stat-card__value stat-card__value--expense">{fmt(totalExpenses)}</span>
        <span class="stat-card__sub">last {periodMonths} months</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">Net Cash Flow</span>
        <span
          class="stat-card__value"
          class:stat-card__value--income={netCashFlow >= 0}
          class:stat-card__value--expense={netCashFlow < 0}
        >{fmt(netCashFlow)}</span>
        <span class="stat-card__sub">{netCashFlow >= 0 ? 'surplus' : 'deficit'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-card__label">Categories</span>
        <span class="stat-card__value">{spendByCategory.length}</span>
        <span class="stat-card__sub">with spending</span>
      </div>
    </div>

    <!-- ── Charts layout ──────────────────────────────────────────────────── -->
    <div class="charts-layout">

      <!-- Row 1: Spending by Category + Cash Flow (side by side) -->
      <div class="chart-grid">

        <!-- Spending by Category (donut chart) -->
        <section class="chart-card" aria-labelledby="cat-title">
          <h2 class="chart-card__title" id="cat-title">Spending by Category</h2>
          <p class="chart-card__subtitle">Last {periodMonths} months · total {fmt(totalSpend)}</p>

          {#if pieSlices.length === 0}
            <div class="chart-empty" role="status">No spending data for this period.</div>
          {:else}
            <div class="pie-layout">
              <svg
                viewBox="0 0 200 200"
                class="pie-svg"
                role="img"
                aria-label="Donut chart: spending by category"
              >
                {#each pieSlices as slice}
                  <path d={slice.path} fill={slice.color}>
                    <title>{slice.category}: {fmt(slice.total)}</title>
                  </path>
                {/each}
                <text x={PIE_CX} y={PIE_CY - 6} class="pie-center-label" text-anchor="middle">
                  Total
                </text>
                <text x={PIE_CX} y={PIE_CY + 14} class="pie-center-value" text-anchor="middle">
                  {fmt(totalSpend)}
                </text>
              </svg>

              <ul class="pie-legend" aria-label="Spending categories legend">
                {#each spendByCategory.slice(0, 8) as cat}
                  {@const pct = totalSpend > 0 ? Math.round((cat.total / totalSpend) * 100) : 0}
                  <li class="pie-legend__item">
                    <span
                      class="pie-legend__dot"
                      style="background:{cat.color}"
                      aria-hidden="true"
                    ></span>
                    <span class="pie-legend__label">{cat.category}</span>
                    <span class="pie-legend__amount">{fmt(cat.total)}</span>
                    <span class="pie-legend__pct" aria-label="{pct}%">
                      ({pct}%)
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </section>

        <!-- Cash Flow (grouped bar chart) -->
        <section class="chart-card" aria-labelledby="cf-title">
          <h2 class="chart-card__title" id="cf-title">Cash Flow</h2>
          <p class="chart-card__subtitle">Income vs expenses by month</p>

          {#if cashFlowChartData === null}
            <div class="chart-empty" role="status">No cash flow data available.</div>
          {:else}
            <div class="chart-legend chart-legend--inline" aria-label="Chart legend">
              <span class="chart-legend__item">
                <span class="chart-legend__swatch" style="background:#22c55e" aria-hidden="true"></span>
                Income
              </span>
              <span class="chart-legend__item">
                <span class="chart-legend__swatch" style="background:#ef4444" aria-hidden="true"></span>
                Expenses
              </span>
            </div>

            <svg
              viewBox="0 0 520 190"
              class="chart-svg"
              role="img"
              aria-label="Cash flow grouped bar chart"
            >
              <!-- Y-axis grid lines + labels -->
              {#each cashFlowChartData.yTicks as tick}
                <line x1={C_X0} y1={tick.y} x2={C_X1} y2={tick.y} class="chart-grid-line" />
                <text x={C_X0 - 4} y={tick.y + 4} class="chart-axis-label" text-anchor="end">
                  {tick.label}
                </text>
              {/each}
              <!-- X-axis baseline -->
              <line x1={C_X0} y1={C_Y1} x2={C_X1} y2={C_Y1} class="chart-axis-line" />

              {#each cashFlowChartData.groups as g}
                <rect
                  x={g.incomeRect.x} y={g.incomeRect.y}
                  width={g.incomeRect.width} height={g.incomeRect.height}
                  fill="#22c55e" rx="2"
                >
                  <title>Income {g.label}: {fmt(g.income)}</title>
                </rect>
                <rect
                  x={g.expRect.x} y={g.expRect.y}
                  width={g.expRect.width} height={g.expRect.height}
                  fill="#ef4444" rx="2"
                >
                  <title>Expenses {g.label}: {fmt(g.expenses)}</title>
                </rect>
                <text
                  x={g.labelX} y={C_Y1 + 13}
                  class="chart-axis-label" text-anchor="middle"
                >
                  {g.label}
                </text>
              {/each}
            </svg>
          {/if}
        </section>
      </div>

      <!-- Spending Trends (line chart — full width) -->
      <section class="chart-card chart-card--full" aria-labelledby="trends-title">
        <h2 class="chart-card__title" id="trends-title">Spending Trends</h2>
        <p class="chart-card__subtitle">Top categories over the last {periodMonths} months</p>

        {#if lineChartData === null}
          <div class="chart-empty" role="status">
            Not enough categorized data to show trends. Try
            <a href="/financial-advisor/review" class="chart-link">reviewing categorizations</a>.
          </div>
        {:else}
          <div class="chart-legend" aria-label="Trend lines legend">
            {#each topCategories as cat}
              <span class="chart-legend__item">
                <span class="chart-legend__swatch" style="background:{cat.color}" aria-hidden="true"></span>
                {cat.category}
              </span>
            {/each}
          </div>

          <svg
            viewBox="0 0 520 190"
            class="chart-svg"
            role="img"
            aria-label="Spending trends line chart"
          >
            <!-- Y-axis grid lines + labels -->
            {#each lineChartData.yTicks as tick}
              <line x1={C_X0} y1={tick.y} x2={C_X1} y2={tick.y} class="chart-grid-line" />
              <text x={C_X0 - 4} y={tick.y + 4} class="chart-axis-label" text-anchor="end">
                {tick.label}
              </text>
            {/each}
            <!-- X-axis baseline -->
            <line x1={C_X0} y1={C_Y1} x2={C_X1} y2={C_Y1} class="chart-axis-line" />
            <!-- X-axis month labels -->
            {#each lineChartData.xLabels as lbl}
              <text x={lbl.x} y={C_Y1 + 13} class="chart-axis-label" text-anchor="middle">
                {lbl.label}
              </text>
            {/each}

            <!-- Lines + dots per category -->
            {#each lineChartData.lines as line}
              <polyline
                points={line.points}
                fill="none"
                stroke={line.color}
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              {#each line.dots as dot}
                {#if dot.value > 0}
                  <circle cx={dot.cx} cy={dot.cy} r="3.5" fill={line.color}>
                    <title>{line.category}: {fmt(dot.value)}</title>
                  </circle>
                {/if}
              {/each}
            {/each}
          </svg>
        {/if}
      </section>

      <!-- Budget Variance (full width) -->
      <section class="chart-card chart-card--full" aria-labelledby="variance-title">
        <h2 class="chart-card__title" id="variance-title">Budget Variance</h2>
        <p class="chart-card__subtitle">
          Actual vs budgeted — {monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].label : 'current month'}
        </p>

        {#if budgets.length === 0}
          <div class="chart-empty" role="status">
            No budgets configured.
            <a href="/financial-advisor/budgets" class="chart-link">Set up budgets</a>
            to see variance analysis.
          </div>
        {:else if varianceChartData === null}
          <div class="chart-empty" role="status">No spending data for the current month.</div>
        {:else}
          <div class="chart-legend chart-legend--inline" aria-label="Chart legend">
            <span class="chart-legend__item">
              <span class="chart-legend__swatch" style="background:#6366f1" aria-hidden="true"></span>
              Budgeted
            </span>
            <span class="chart-legend__item">
              <span class="chart-legend__swatch" style="background:#22c55e" aria-hidden="true"></span>
              Actual (under)
            </span>
            <span class="chart-legend__item">
              <span class="chart-legend__swatch" style="background:#ef4444" aria-hidden="true"></span>
              Actual (over)
            </span>
          </div>

          <svg
            viewBox="0 0 520 190"
            class="chart-svg"
            role="img"
            aria-label="Budget variance grouped bar chart"
          >
            <!-- Y-axis grid + labels -->
            {#each varianceChartData.yTicks as tick}
              <line x1={C_X0} y1={tick.y} x2={C_X1} y2={tick.y} class="chart-grid-line" />
              <text x={C_X0 - 4} y={tick.y + 4} class="chart-axis-label" text-anchor="end">
                {tick.label}
              </text>
            {/each}
            <!-- X-axis baseline -->
            <line x1={C_X0} y1={C_Y1} x2={C_X1} y2={C_Y1} class="chart-axis-line" />

            {#each varianceChartData.bars as bar}
              <!-- Budgeted bar -->
              <rect
                x={bar.budgetedRect.x} y={bar.budgetedRect.y}
                width={bar.budgetedRect.width} height={bar.budgetedRect.height}
                fill="#6366f1" rx="2"
              >
                <title>{bar.category} budgeted: {fmt(bar.budgeted)}</title>
              </rect>
              <!-- Actual bar -->
              <rect
                x={bar.actualRect.x} y={bar.actualRect.y}
                width={bar.actualRect.width} height={bar.actualRect.height}
                fill={bar.isOver ? '#ef4444' : '#22c55e'} rx="2"
              >
                <title>{bar.category} actual: {fmt(bar.actual)}</title>
              </rect>
              <!-- Category label -->
              <text
                x={bar.labelX} y={C_Y1 + 13}
                class="chart-axis-label" text-anchor="middle"
              >
                {bar.labelText}
              </text>
            {/each}
          </svg>

          <!-- Summary table -->
          <div class="variance-table-wrap">
            <Table class="variance-table" aria-label="Budget variance details">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" class="variance-table__num">Budgeted</th>
                  <th scope="col" class="variance-table__num">Actual</th>
                  <th scope="col" class="variance-table__num">Variance</th>
                </tr>
              </thead>
              <tbody>
                {#each budgetVariance as row}
                  {@const diff = row.actual - row.budgeted}
                  <tr class:variance-row--over={row.isOver}>
                    <td>{row.category}</td>
                    <td class="variance-table__num">{fmt(row.budgeted)}</td>
                    <td class="variance-table__num">{fmt(row.actual)}</td>
                    <td
                      class="variance-table__num"
                      class:variance-cell--over={row.isOver}
                      class:variance-cell--under={!row.isOver}
                    >
                      {diff > 0 ? '+' : ''}{fmt(diff)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </Table>
          </div>
        {/if}
      </section>

    </div>
  {/if}
</div>

<style>
  /* ── Page layout ─────────────────────────────────────────────────────────── */
  .reports-page {
    padding: var(--space-6, 1.5rem);
    max-width: 64rem;
    margin: 0 auto;
  }

  /* ── Page header ─────────────────────────────────────────────────────────── */
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4, 1rem);
    margin-bottom: var(--space-6, 1.5rem);
    flex-wrap: wrap;
  }

  .page-header__title {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0;
    color: var(--color-text, #111827);
  }

  .page-header__subtitle {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    margin: var(--space-1, 0.25rem) 0 0;
  }

  /* ── Period selector ─────────────────────────────────────────────────────── */
  .period-selector {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    flex-shrink: 0;
  }

  .period-selector__label {
    font-size: 0.875rem;
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
  }

  .period-selector__select {
    font-size: 0.875rem;
  }

  /* ── Skeleton loader ─────────────────────────────────────────────────────── */
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
  }

  .skeleton-card {
    height: 10rem;
    border-radius: var(--radius-lg, 0.75rem);
    background: var(--color-surface-2, #f3f4f6);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* ── Summary stats row ───────────────────────────────────────────────────── */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3, 0.75rem);
    margin-bottom: var(--space-6, 1.5rem);
  }

  .stat-card {
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    padding: var(--space-4, 1rem);
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 0.25rem);
  }

  .stat-card__label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-card__value {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--color-text, #111827);
    line-height: 1.2;
  }

  .stat-card__value--income {
    color: var(--color-success, #16a34a);
  }

  .stat-card__value--expense {
    color: var(--color-danger, #dc2626);
  }

  .stat-card__sub {
    font-size: 0.75rem;
    color: var(--color-text-subtle, #9ca3af);
  }

  /* ── Charts layout ───────────────────────────────────────────────────────── */
  .charts-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-5, 1.25rem);
  }

  .chart-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5, 1.25rem);
  }

  /* ── Chart card ──────────────────────────────────────────────────────────── */
  .chart-card {
    background: var(--color-surface, #ffffff);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-lg, 0.75rem);
    padding: var(--space-5, 1.25rem);
  }

  .chart-card--full {
    grid-column: 1 / -1;
  }

  .chart-card__title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text, #111827);
    margin: 0 0 var(--space-1, 0.25rem);
  }

  .chart-card__subtitle {
    font-size: 0.8125rem;
    color: var(--color-text-muted, #6b7280);
    margin: 0 0 var(--space-4, 1rem);
  }

  /* ── Empty chart state ───────────────────────────────────────────────────── */
  .chart-empty {
    padding: var(--space-10, 2.5rem) var(--space-6, 1.5rem);
    text-align: center;
    font-size: 0.9375rem;
    color: var(--color-text-muted, #6b7280);
  }

  .chart-link {
    color: var(--color-primary, #6366f1);
    text-decoration: underline;
  }

  .chart-link:hover {
    color: var(--color-primary-hover, #4f46e5);
  }

  /* ── Chart legend ────────────────────────────────────────────────────────── */
  .chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3, 0.75rem);
    margin-bottom: var(--space-4, 1rem);
  }

  .chart-legend--inline {
    gap: var(--space-4, 1rem);
  }

  .chart-legend__item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    font-size: 0.8125rem;
    color: var(--color-text-muted, #6b7280);
  }

  .chart-legend__swatch {
    display: inline-block;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ── SVG chart elements ──────────────────────────────────────────────────── */
  .chart-svg {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }

  :global(.chart-grid-line) {
    stroke: var(--color-border, #e5e7eb);
    stroke-width: 1;
  }

  :global(.chart-axis-line) {
    stroke: var(--color-border, #e5e7eb);
    stroke-width: 1.5;
  }

  :global(.chart-axis-label) {
    font-size: 9px;
    fill: var(--color-text-subtle, #9ca3af);
    font-family: inherit;
  }

  /* ── Donut / pie chart ───────────────────────────────────────────────────── */
  .pie-layout {
    display: flex;
    gap: var(--space-4, 1rem);
    align-items: flex-start;
  }

  .pie-svg {
    width: 9rem;
    flex-shrink: 0;
    overflow: visible;
  }

  :global(.pie-center-label) {
    font-size: 11px;
    fill: var(--color-text-muted, #6b7280);
    font-family: inherit;
  }

  :global(.pie-center-value) {
    font-size: 13px;
    font-weight: 700;
    fill: var(--color-text, #111827);
    font-family: inherit;
  }

  /* ── Pie legend ──────────────────────────────────────────────────────────── */
  .pie-legend {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
  }

  .pie-legend__item {
    display: grid;
    grid-template-columns: 0.625rem 1fr auto auto;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    font-size: 0.8125rem;
  }

  .pie-legend__dot {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .pie-legend__label {
    color: var(--color-text, #111827);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pie-legend__amount {
    color: var(--color-text, #111827);
    font-weight: 500;
    white-space: nowrap;
  }

  .pie-legend__pct {
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
    min-width: 2.5rem;
    text-align: right;
  }

  /* ── Budget variance table ───────────────────────────────────────────────── */
  .variance-table-wrap {
    margin-top: var(--space-5, 1.25rem);
    overflow-x: auto;
    border-radius: var(--radius-md, 0.5rem);
    border: 1px solid var(--color-border, #e5e7eb);
  }

  .variance-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .variance-table thead tr {
    background: var(--color-surface-2, #f3f4f6);
  }

  .variance-table th,
  .variance-table td {
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    text-align: left;
    color: var(--color-text, #111827);
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }

  .variance-table th {
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .variance-table tbody tr:last-child td {
    border-bottom: none;
  }

  .variance-table tbody tr:hover {
    background: var(--color-surface-2, #f3f4f6);
  }

  .variance-table__num {
    text-align: right;
  }

  .variance-row--over {
    background: var(--color-danger-subtle, #fef2f2);
  }

  .variance-cell--over {
    color: var(--color-danger, #dc2626);
    font-weight: 600;
  }

  .variance-cell--under {
    color: var(--color-success, #16a34a);
    font-weight: 600;
  }

  /* ── Responsive breakpoints ──────────────────────────────────────────────── */
  @media (max-width: 760px) {
    .stats-row {
      grid-template-columns: repeat(2, 1fr);
    }

    .chart-grid {
      grid-template-columns: 1fr;
    }

    .pie-layout {
      flex-direction: column;
      align-items: center;
    }

    .pie-svg {
      width: 8rem;
    }
  }

  @media (max-width: 480px) {
    .stats-row {
      grid-template-columns: 1fr 1fr;
    }

    .stat-card__value {
      font-size: 1.125rem;
    }
  }
</style>
