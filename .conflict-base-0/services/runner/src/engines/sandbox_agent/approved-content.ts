/**
 * Wiring for `@ag.file` markers: the gate hook and the relay hook (slice S3b).
 *
 * Contracts: execution-authorization.md, workspace-import.md 8, change-set.md 6.
 *
 * Composition only. The policy lives in `tools/commit-authorization.ts`; this file builds the
 * two callbacks the turn hands to `attachPermissionResponder` and `startToolRelay`, and picks
 * the workspace reader for the platform the run is on.
 */
import { decide, type PermissionPlan } from "../../permission-plan.ts";
import { ConversationDecisions } from "../../responder.ts";
import {
  CommitAuthorizer,
  CommitAuthorizationError,
  MarkerResolutionError,
} from "../../tools/commit-authorization.ts";
import { computeCatalogGeneration } from "../../tools/catalog-generation.ts";
import { buildConfigTextFetcher } from "../../tools/config-text.ts";
import { ExecutionAuthorizationStore } from "../../tools/execution-authorization.ts";
import { FrozenValueStore } from "../../tools/frozen-value-store.ts";
import {
  DaytonaWorkspaceReader,
  LocalWorkspaceReader,
  type WorkspaceReader,
} from "../../tools/workspace-reader.ts";
import type { RelayExecutionAuthorizer } from "../../tools/relay.ts";
import type {
  ResolvedToolSpec,
  RunContext,
  ToolCallbackContext,
} from "../../protocol.ts";
import type { AttachPermissionResponderInput } from "./acp-interactions.ts";

/**
 * The per-SESSION record and byte store.
 *
 * Session-scoped, not turn-scoped, because a parked approval must survive to its live resume:
 * the human approved specific bytes, and the resume commits those exact bytes. The turn clears
 * it whenever it did NOT park, and a cold resume gets a new environment and therefore an empty
 * store — which is what forces a fresh gate instead of executing bytes nobody saw.
 */
export interface CommitAuthorizationState {
  frozen: FrozenValueStore;
  store: ExecutionAuthorizationStore;
}

export function createCommitAuthorizationState(): CommitAuthorizationState {
  const frozen = new FrozenValueStore();
  return { frozen, store: new ExecutionAuthorizationStore(frozen) };
}

function workspaceReaderFor(input: {
  isDaytona: boolean;
  cwd: string;
  sandbox: any;
}): WorkspaceReader {
  if (!input.isDaytona) return new LocalWorkspaceReader(input.cwd);
  return new DaytonaWorkspaceReader(input.cwd, async (argv) => {
    const result = await input.sandbox.runProcess({
      command: argv[0],
      args: argv.slice(1),
      timeoutMs: 30_000,
    });
    const stdout = result?.stdout ?? "";
    return {
      stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout)),
      exitCode: Number(result?.exitCode ?? 0),
    };
  });
}

export interface ApprovedContentWiring {
  onResolveApprovedContent: NonNullable<
    AttachPermissionResponderInput["onResolveApprovedContent"]
  >;
  authorizer: RelayExecutionAuthorizer;
}

export function buildApprovedContentWiring(input: {
  state: CommitAuthorizationState;
  isDaytona: boolean;
  workspaceCwd: string;
  sandbox: any;
  callback: ToolCallbackContext | undefined;
  runContext: RunContext | undefined;
  permissionPlan: PermissionPlan;
  toolSpecs: ResolvedToolSpec[];
  turnId: string;
  sessionId: string;
  signal?: AbortSignal;
  log?: (msg: string) => void;
}): ApprovedContentWiring {
  // Computed once per turn: the catalog cannot change under a turn, and a per-call recompute
  // would make the generation check compare a value to itself.
  const generation = computeCatalogGeneration(input.toolSpecs);
  const specsByName = new Map(
    input.toolSpecs.map((spec) => [spec.name, spec] as const),
  );

  const authorizerCore = new CommitAuthorizer({
    reader: workspaceReaderFor({
      isDaytona: input.isDaytona,
      cwd: input.workspaceCwd,
      sandbox: input.sandbox,
    }),
    store: input.state.store,
    catalogGeneration: () => generation,
    fetchOldText: buildConfigTextFetcher({
      callback: input.callback,
      runContext: input.runContext,
      signal: input.signal,
    }),
    turnId: input.turnId,
    sessionId: input.sessionId,
    decideInline: (toolName, args) => {
      const spec = specsByName.get(toolName);
      // The permission PLAN, never the relay guard's pass-through: the guard passes `ask` on a
      // non-Pi harness for compatibility, and reading that as policy would reopen the very hole
      // the authorization record closes.
      //
      // The decision store is empty on purpose. A stored "always allow" is a human's earlier
      // answer about a TOOL; the exception here is a statement by the policy owner about this
      // call, and only a policy `allow` is that.
      const verdict = decide(
        {
          executor: "relay",
          toolName,
          specPermission: spec?.permission,
          readOnlyHint: spec?.readOnly,
          args,
        },
        input.permissionPlan,
        new ConversationDecisions(new Map()),
      );
      return verdict.kind === "allow" ? "allow" : "gate";
    },
    log: input.log,
  });

  return {
    onResolveApprovedContent: async ({ toolName, toolCallId, args }) => {
      if (!toolName || !toolCallId) {
        // Without both identifiers a record cannot be keyed to this call, so it could not be
        // verified at execution. A call carrying markers must not proceed on that footing.
        return authorizerCore.markersIn(args).length === 0
          ? { ok: true }
          : {
              ok: false,
              reason:
                "this call references workspace files but carries no tool identity to bind the approval to",
            };
      }
      try {
        const manifest = await authorizerCore.mintForGate({
          toolName,
          toolCallId,
          args,
        });
        return { ok: true, manifest };
      } catch (error) {
        if (
          error instanceof CommitAuthorizationError ||
          error instanceof MarkerResolutionError
        ) {
          return { ok: false, reason: error.message };
        }
        throw error;
      }
    },
    authorizer: async (spec, req) =>
      authorizerCore.authorizeExecution({
        toolName: spec.name,
        toolCallId: req.toolCallId,
        args: req.args,
      }),
  };
}
