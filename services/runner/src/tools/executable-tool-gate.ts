import type { ResolvedToolSpec } from "../protocol.ts";

export type ExecutableToolVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "pendingApproval" };

export interface ExecutableToolGateRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  spec: ResolvedToolSpec;
}

export interface ExecutableToolGate {
  onExecutableTool: (
    request: ExecutableToolGateRequest,
  ) => Promise<ExecutableToolVerdict>;
  onPause?: () => void;
}
