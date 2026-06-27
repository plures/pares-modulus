<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge, Callout, Button, Input, Select, Card } from '@plures/design-dojo';
  import { slide, fade } from 'svelte/transition';
  import { getPluginContext } from '../lib/context.js';
  import type { PluginContext, DataCollection } from '@plures/pares-radix';
  import {
    FA_GOALS_COLLECTION,
    calculateGoalProgress,
    generateGoalId,
    type Goal,
  } from '../lib/goals.js';

  // eslint-disable-next-line plures/no-raw-stores
  let ctx: PluginContext | null = null;
  let collection: DataCollection<Goal> | undefined;

  let goals = $state<Goal[]>([]);
  let showAddForm = $state(false);
  let showProgressForm = $state(false);
  let selectedGoalId = $state('');
  let progressAmount = $state(0);
  let errors = $state<string[]>([]);

  let newGoal = $state<Partial<Goal>>({
    name: '',
    targetAmount: 0,
    currentAmount: 0,
    category: '',
    isCompleted: false,
  });

  // ── Load goals from PluresDB on mount (Accounts page pattern) ─────────────
  onMount(() => {
    ctx = getPluginContext();
    collection = ctx?.data.collection<Goal>(FA_GOALS_COLLECTION);
    loadGoals().catch(() => {
      errors = ['Failed to load goals.'];
    });
  });

  async function loadGoals(): Promise<void> {
    try {
      goals = (await collection?.query()) ?? [];
    } catch {
      goals = [];
      ctx?.notify.error('Failed to load goals.');
    }
  }

  async function handleAddGoal(): Promise<void> {
    errors = [];

    const targetAmount = Number(newGoal.targetAmount);

    if (!newGoal.name || Number.isNaN(targetAmount)) {
      errors = ['Please fill in all required fields'];
      return;
    }

    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      errors = ['Target amount must be a valid positive number'];
      return;
    }

    if (!collection) {
      errors = ['Database not available.'];
      return;
    }

    const goal: Goal = {
      id: generateGoalId(),
      name: newGoal.name,
      targetAmount: targetAmount,
      currentAmount: newGoal.currentAmount || 0,
      ...(newGoal.category && { category: newGoal.category }),
      ...(newGoal.deadline && { deadline: new Date(newGoal.deadline) }),
      isCompleted: false,
      createdAt: new Date(),
    };

    try {
      await collection.put(goal.id, goal);
      goals = [...goals, goal];
      ctx?.notify.success('Goal created.');
      showAddForm = false;
      resetForm();
    } catch {
      errors = ['Failed to save goal. Please try again.'];
      ctx?.notify.error('Failed to save goal.');
    }
  }

  function resetForm() {
    newGoal = {
      name: '',
      targetAmount: 0,
      currentAmount: 0,
      category: '',
      isCompleted: false,
    };
    errors = [];
  }

  async function updateGoalProgress(id: string, amount: number): Promise<void> {
    errors = [];

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      errors = ['Progress amount must be a valid positive number'];
      return;
    }

    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    if (!collection) {
      errors = ['Database not available.'];
      return;
    }

    const newAmount = Math.max(0, goal.currentAmount || 0) + parsedAmount;
    const updated: Goal = {
      ...goal,
      currentAmount: newAmount,
      isCompleted: newAmount >= goal.targetAmount,
    };

    try {
      await collection.put(updated.id, updated);
      goals = goals.map(g => (g.id === updated.id ? updated : g));
      showProgressForm = false;
      progressAmount = 0;
      selectedGoalId = '';
    } catch {
      errors = ['Failed to update progress. Please try again.'];
      ctx?.notify.error('Failed to update goal progress.');
    }
  }

  function showProgressInput(id: string) {
    selectedGoalId = id;
    showProgressForm = true;
    progressAmount = 0;
  }

  function cancelProgress() {
    showProgressForm = false;
    selectedGoalId = '';
    progressAmount = 0;
  }

  async function handleDeleteGoal(id: string): Promise<void> {
    if (!confirm('Are you sure you want to delete this goal?')) return;
    if (!collection) return;
    try {
      await collection.delete(id);
      goals = goals.filter(g => g.id !== id);
      ctx?.notify.success('Goal deleted.');
    } catch {
      ctx?.notify.error('Failed to delete goal.');
    }
  }

  const categories = [
    'Emergency Fund',
    'Vacation',
    'Home Purchase',
    'Car Purchase',
    'Education',
    'Retirement',
    'Debt Payoff',
    'Investment',
    'Other',
  ];
</script>

<div class="page">
  <header class="page-header">
    <h1 class="page-title">Goals Tracking</h1>
    <Button
      variant={showAddForm ? 'secondary' : 'primary'}
      onclick={() => (showAddForm = !showAddForm)}
    >
      {showAddForm ? 'Cancel' : 'Add Goal'}
    </Button>
  </header>

  {#if showAddForm}
    <div transition:slide>
      <Card class="add-form-card">
        <h2 class="form-heading">Create New Goal</h2>

        {#if errors.length > 0}
          <Callout tone="error" className="form-errors">
            {#each errors as error}
              <p>{error}</p>
            {/each}
          </Callout>
        {/if}

        <form
          onsubmit={e => {
            e.preventDefault();
            handleAddGoal();
          }}
          class="goal-form"
        >
          <Input
            label="Goal Name *"
            id="name"
            type="text"
            bind:value={newGoal.name}
            placeholder="e.g., Emergency Fund"
            required
          />

          <Select label="Category" id="category" bind:value={newGoal.category}>
            <option value="">Select a category</option>
            {#each categories as category}
              <option value={category}>{category}</option>
            {/each}
          </Select>

          <div class="form-row">
            <Input
              label="Target Amount *"
              id="targetAmount"
              type="number"
              step="0.01"
              bind:value={newGoal.targetAmount}
              placeholder="10000.00"
              required
            />
            <Input
              label="Current Amount"
              id="currentAmount"
              type="number"
              step="0.01"
              bind:value={newGoal.currentAmount}
              placeholder="0.00"
            />
          </div>

          <Input
            label="Deadline (Optional)"
            id="deadline"
            type="date"
            bind:value={newGoal.deadline}
          />

          <div class="form-actions">
            <Button type="button" variant="secondary" onclick={resetForm}>Reset</Button>
            <Button type="submit" variant="primary">Create Goal</Button>
          </div>
        </form>
      </Card>
    </div>
  {/if}

  {#if showProgressForm}
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-modal-title"
    >
      <div transition:fade class="modal-backdrop" onclick={cancelProgress}></div>
      <div class="modal-card">
        <Card elevated>
          <h2 id="progress-modal-title" class="form-heading">Add Progress</h2>
          <form
            onsubmit={e => {
              e.preventDefault();
              updateGoalProgress(selectedGoalId, progressAmount);
            }}
            class="progress-form"
          >
            <Input
              label="Amount to Add *"
              id="progressAmount"
              type="number"
              step="0.01"
              bind:value={progressAmount}
              placeholder="100.00"
              required
              autofocus
            />
            <div class="form-actions">
              <Button type="button" variant="secondary" onclick={cancelProgress}>Cancel</Button>
              <Button type="submit" variant="primary">Add Progress</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  {/if}

  <section class="goals-section">
    <h2 class="section-heading">Your Goals</h2>

    {#if goals.length === 0}
      <Card>
        <div class="empty-state">
          <span class="empty-icon">🎯</span>
          <h3>No goals yet</h3>
          <p>Set your first financial goal to start tracking your progress!</p>
        </div>
      </Card>
    {:else}
      <div class="goal-grid">
        {#each goals as goal}
          {@const progress = calculateGoalProgress(goal)}
          <Card elevated class={goal.isCompleted ? 'goal-card--completed' : ''}>
            <div class="goal-content">
              <div class="goal-top">
                <h3 class="goal-name">{goal.name}</h3>
                <Badge variant={goal.isCompleted ? 'success' : 'accent'}>
                  {goal.isCompleted ? '✓ Completed' : 'In Progress'}
                </Badge>
              </div>

              <dl class="goal-details">
                {#if goal.category}
                  <div class="goal-detail-row">
                    <dt>Category</dt>
                    <dd>{goal.category}</dd>
                  </div>
                {/if}
                <div class="goal-detail-row">
                  <dt>Target</dt>
                  <dd>${goal.targetAmount.toFixed(2)}</dd>
                </div>
                <div class="goal-detail-row">
                  <dt>Current</dt>
                  <dd>${(goal.currentAmount || 0).toFixed(2)}</dd>
                </div>
                <div class="goal-detail-row">
                  <dt>Remaining</dt>
                  <dd>${progress.amountRemaining.toFixed(2)}</dd>
                </div>
                {#if goal.deadline}
                  <div class="goal-detail-row">
                    <dt>Deadline</dt>
                    <dd>{new Date(goal.deadline).toLocaleDateString()}</dd>
                  </div>
                {/if}
              </dl>

              <div class="goal-progress">
                <div
                  class="progress-track"
                  role="progressbar"
                  aria-label="{goal.name} goal progress"
                  aria-valuenow={Math.min(100, progress.percentComplete)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    class="progress-fill"
                    class:progress-fill--complete={goal.isCompleted}
                    style="width: {Math.min(100, progress.percentComplete)}%"
                  ></div>
                </div>
                <p class="progress-label">{progress.percentComplete.toFixed(1)}% complete</p>
              </div>

              <div class="goal-actions">
                {#if goal.isCompleted}
                  <Button size="sm" variant="ghost" disabled>Goal Achieved! 🎉</Button>
                {:else}
                  <Button size="sm" variant="secondary" onclick={() => showProgressInput(goal.id)}>
                    Add Progress
                  </Button>
                {/if}
                <Button size="sm" variant="danger" onclick={() => handleDeleteGoal(goal.id)}>
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 75rem;
    margin: 0 auto;
    padding: var(--space-8);
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-6);
  }

  .page-title {
    font-size: var(--font-size-3xl);
    font-weight: var(--font-weight-bold);
    margin: 0;
  }

  .add-form-card {
    margin-bottom: var(--space-6);
  }

  .form-heading {
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
    margin: 0 0 var(--space-4) 0;
  }

  .form-errors p {
    margin: 0;
  }

  .goal-form,
  .progress-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .form-actions {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
    padding-top: var(--space-2);
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: var(--space-4);
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    background-color: rgb(0 0 0 / 0.5);
  }

  .modal-card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 26rem;
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: var(--space-8);
  }

  .empty-icon {
    font-size: 3rem;
    display: block;
    margin-bottom: var(--space-4);
  }

  .empty-state h3 {
    margin: 0 0 var(--space-2) 0;
  }

  .empty-state p {
    color: var(--color-text-secondary);
    margin: 0;
  }

  /* Goals grid */
  .goals-section {
    margin-top: var(--space-6);
  }

  .section-heading {
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
    margin: 0 0 var(--space-4) 0;
  }

  .goal-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
    gap: var(--space-6);
  }

  :global(.goal-card--completed) {
    border-color: var(--color-success-500) !important;
  }

  .goal-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .goal-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .goal-name {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
    margin: 0;
  }

  .goal-details {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .goal-detail-row {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-size-sm);
  }

  .goal-detail-row dt {
    color: var(--color-text-secondary);
  }

  .goal-detail-row dd {
    margin: 0;
    font-weight: var(--font-weight-medium);
  }

  .goal-progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .progress-track {
    background-color: var(--color-neutral-200);
    border-radius: var(--radius-full);
    height: 0.75rem;
    overflow: hidden;
  }

  .progress-fill {
    background-color: var(--color-accent);
    height: 100%;
    border-radius: var(--radius-full);
    transition: width var(--motion-duration-slow) var(--motion-easing-default);
  }

  .progress-fill--complete {
    background-color: var(--color-success-500);
  }

  .progress-label {
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
    margin: 0;
  }

  .goal-actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
