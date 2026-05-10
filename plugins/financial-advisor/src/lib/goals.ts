/**
 * Goal types and helpers for the fa-goals PluresDB collection.
 */

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  category?: string;
  deadline?: Date | string;
  isCompleted: boolean;
  createdAt: Date | string;
}

export const FA_GOALS_COLLECTION = 'fa-goals';

export function generateGoalId(): string {
  return `goal-${Date.now()}`;
}

export interface GoalProgress {
  percentComplete: number;
  amountRemaining: number;
}

export function calculateGoalProgress(goal: Goal): GoalProgress {
  const current = goal.currentAmount || 0;
  const target = goal.targetAmount;
  const percentComplete = target > 0 ? (current / target) * 100 : 0;
  const amountRemaining = Math.max(0, target - current);
  
  return {
    percentComplete: Math.min(100, percentComplete),
    amountRemaining,
  };
}
