/**
 * Shared UI-state shape for the permission simulator. One object, several
 * coordinated panels (TensorFlow-Playground pattern): KnobsPanel writes the
 * policy; ToolPalette writes the call; OutcomePanel only reads.
 */
import type { GateDescriptor, PermissionPlan, PermissionRule, PlanRung, ToolPermission, Verdict } from "./decide";
import type { PolicyDefault, ToolExample } from "../../model/types";

export type Harness = "pi" | "claude";
export type ToolOverride = "inherit" | ToolPermission;

export interface PermSimState {
  harness: Harness;
  policyDefault: PolicyDefault;
  rules: PermissionRule[];
  killSwitch: boolean;
  /** Per-tool-example override, keyed by ToolExample.name. */
  overrides: Record<string, ToolOverride>;
  selectedTool: string;
  /** Only meaningful for the "bash" tool example, to exercise Bash(rm:*)-style rules. */
  bashCommand: string;
}

/** Seeded from the model's own testVectors (TV3/TV4), per PLAN.md's "prefilled examples". */
export const DEFAULT_RULES: PermissionRule[] = [{ pattern: "Bash(rm:*)", permission: "ask" }];

export const DEFAULT_BASH_COMMAND = "ls -la";

/** The outcome of the most recent "Call tool" click, plus its HITL resume state (if any). */
export interface CallState {
  gate: GateDescriptor;
  tool: ToolExample;
  verdict: Verdict;
  planRung: PlanRung;
  /**
   * Snapshot of the plan that produced `verdict`, taken at "Call tool" time.
   * A HITL resume (Approve/Deny while paused) must re-run decide() against
   * THIS plan, not whatever the knobs currently say: the knobs can change
   * while a call sits pendingApproval (e.g. toggling the kill switch), and
   * the resume is answering the ask that was actually raised, not a new one.
   */
  plan: PermissionPlan;
  resumed?: { decision: "allow" | "deny"; verdict: Verdict };
}

export function initialPermSimState(): PermSimState {
  return {
    harness: "pi",
    policyDefault: "allow_reads",
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    killSwitch: false,
    overrides: {},
    selectedTool: "bash",
    bashCommand: DEFAULT_BASH_COMMAND,
  };
}
