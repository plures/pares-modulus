/**
 * Local type declarations for @plures/pares-radix.
 *
 * These mirror the public API surface used by pares-modulus plugins so that
 * type-checking and linting work in CI without requiring the (unpublished)
 * runtime package as a dependency.
 */

export interface ResourceRequirement {
  type: string;
  minCount?: number;
  emptyMessage?: string;
  fulfillHref?: string;
  fulfillLabel?: string;
}

export interface RouteConfig {
  path: string;
  component: () => Promise<unknown>;
  title: string;
  requires?: ResourceRequirement[];
}

export interface NavItem {
  href: string;
  label: string;
  icon?: string;
  children?: NavItem[];
}

export interface SettingOption {
  value: unknown;
  label: string;
}

export interface SettingConfig {
  key: string;
  type: 'select' | 'toggle' | 'number' | 'text' | string;
  label: string;
  description?: string;
  default?: unknown;
  options?: SettingOption[];
  group?: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  component: () => Promise<unknown>;
  priority?: number;
}

export interface HelpSection {
  title: string;
  icon?: string;
  content: string;
  priority?: number;
}

export interface OnboardingStep {
  title: string;
  description: string;
  icon?: string;
  href: string;
  actionLabel: string;
  isComplete: () => boolean;
  after?: string[];
}

export interface Expectation {
  id: string;
  domain: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  validate: () => boolean;
}

export interface InferenceResult {
  field: string;
  value: unknown;
  confidence: number;
  reasoning: string;
}

export interface ConfirmedInference {
  field: string;
  value: unknown;
  sourceId: string;
}

export interface InferenceInput {
  record: Record<string, unknown>;
  history?: unknown[];
  confirmedInferences: ConfirmedInference[];
}

export interface InferenceRule {
  id: string;
  name: string;
  description: string;
  appliesTo: string[];
  baseConfidence: number;
  evaluate(input: InferenceInput): InferenceResult | null;
}

export interface RadixPlugin {
  id: string;
  name: string;
  version: string;
  icon?: string;
  description: string;
  routes?: RouteConfig[];
  navItems?: NavItem[];
  settings?: SettingConfig[];
  dashboardWidgets?: DashboardWidget[];
  helpSections?: HelpSection[];
  onboardingSteps?: OnboardingStep[];
  rules?: InferenceRule[];
  expectations?: Expectation[];
  constraints?: unknown[];
  onActivate?: (ctx: unknown) => Promise<void>;
  onDeactivate?: () => Promise<void>;
  onDataExport?: () => Promise<Record<string, unknown>>;
  onDataImport?: (data: unknown) => Promise<void>;
}
