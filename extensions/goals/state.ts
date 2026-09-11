import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const GOAL_ENTRY = "pi-goals-state";
export type GoalStatus = "active" | "paused" | "needs_input" | "budget_limited" | "complete";
export type GoalState = {
  id: string;
  objective: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  tokenBudget?: number;
  approxTokensUsed?: number;
  autoContinue: boolean;
  continuationTurns: number;
  maxContinuationTurns: number;
  lastNotice?: string;
  inputRequest?: { question: string; reason: string };
};
export type GoalEntry = {
  action: "set" | "status" | "clear" | "account";
  goal?: GoalState;
  cleared?: boolean;
};

export function readGoal(branch: readonly SessionEntry[]): GoalState | null {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY) continue;
    const data = entry.data as GoalEntry | undefined;
    if (!data) continue;
    if (data.cleared || data.action === "clear") return null;
    if (data.goal) return structuredClone(data.goal);
  }
  return null;
}

export function goalNeedsInput(branch: readonly SessionEntry[]): boolean {
  return readGoal(branch)?.status === "needs_input";
}
