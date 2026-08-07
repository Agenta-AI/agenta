/**
 * Fetching the text a commit is about to replace (slice S3b).
 *
 * Contract: docs/design/agent-config-editing/contracts/workspace-import.md 8.4.2 and 8.4.3.
 *
 * The approval card for a field replaced from one file shows a diff, and the OLD side of that
 * diff must be the stored text at the operation's own `base_revision_id`. Not the configuration
 * running in the session — that is a real hole, not a technicality:
 *
 *   The session may be running revision N. The model may correctly supply head N+1 as
 *   `base_revision_id`, because it read the head with `read_config`. If the card diffs against
 *   the session's N, the human approves an N-to-new change; the commit's base check then passes,
 *   because the base really is N+1; and N+1 is replaced by text the human never compared
 *   against it. Nothing fails, and the wrong thing commits.
 *
 * `read_config` projects a target path out of a revision, and it is the authoritative
 * implementation of that projection — the same grammar the operation's target uses, including
 * the selector forms. It answers for the variant's CURRENT head, though, and carries no
 * revision selector. So this fetcher uses it and then REQUIRES the answer to come from the base
 * the operation names, by comparing the returned `base_revision_id`.
 *
 * That comparison is what makes the card honest without duplicating the projection here. Its
 * only refusal is a commit whose base is not the head — and such a commit cannot succeed
 * anyway: the base is a precondition, so the commit itself would answer 409. The conflict
 * simply surfaces one step earlier, with the same next step the model already knows.
 */
import { callAgentaTool } from "./callback.ts";
import { resolveCtxToken } from "./direct.ts";
import type { RunContext, ToolCallbackContext } from "../protocol.ts";
import type { ConfigTextFetcher } from "./commit-authorization.ts";

/**
 * The read op's call ref, dispatched by `POST /tools/call` (API migration, step 8).
 *
 * This used to POST `/api/workflows/revisions/read-config` directly. That route is being deleted:
 * the op now runs behind a registered handler in the API process
 * (`core/tools/platform_handlers.py`, `READ_CONFIG_CALL_REF`), reached through the same generic
 * tool seam every other tool uses. The body is unchanged, because the handler reads the same
 * `target` and `max_bytes` the route did, so this is a transport swap and not a reshape.
 *
 * WHAT CHANGES FOR FAILURES. The route answered a domain failure with a non-2xx whose FastAPI
 * `detail` carried the reason. The handler answers HTTP 200 with `STATUS_CODE_ERROR` and the
 * canonical `{code, message, retryable, next_step, details}` envelope in the tool result.
 * `callAgentaTool` throws on that status, so a refusal still arrives here as a throw and still
 * reaches the caller the same way. The envelope rides the message.
 */
const READ_CONFIG_CALL_REF = "tools.agenta.read_config";

/** The handler's own budget (`READ_CONFIG_DEFAULT_TIMEOUT_MS`), mirrored so the runner does not
 *  give up before the API does. */
const READ_CONFIG_TIMEOUT_MS = 15_000;

/** The endpoint's ceiling. A long instructions document must fit, or the card cannot show it. */
const READ_CONFIG_MAX_BYTES = 262144;

export function buildConfigTextFetcher(input: {
  callback: ToolCallbackContext | undefined;
  runContext: RunContext | undefined;
  signal?: AbortSignal;
}): ConfigTextFetcher {
  return async ({ revisionId, target }) => {
    const endpoint = input.callback?.endpoint;
    if (!endpoint) {
      throw new Error("no Agenta callback endpoint is configured for this run");
    }
    // Bound server-side for the tool itself; the runner fills the same two tokens here so the
    // read is scoped to the run's OWN variant and can never name another one.
    const variantId = resolveCtxToken(
      input.runContext,
      "$ctx.workflow.variant.id",
    );
    if (typeof variantId !== "string" || !variantId) {
      throw new Error("this run has no workflow variant to read");
    }
    const isDraft = resolveCtxToken(input.runContext, "$ctx.workflow.is_draft");

    const body: Record<string, unknown> = {
      target: {
        workflow_variant_id: variantId,
        ...(typeof isDraft === "boolean" ? { run_is_draft: isDraft } : {}),
        path: target,
      },
      max_bytes: READ_CONFIG_MAX_BYTES,
    };
    // A synthetic id: this read is the RUNNER's, not a call the model made, so there is no
    // tool-call id to echo. It only travels back as `tool_call_id`, and naming it makes the
    // API-side log say which reader asked.
    const raw = await callAgentaTool(
      endpoint,
      input.callback?.authorization,
      READ_CONFIG_CALL_REF,
      `config-text-${revisionId}`,
      body,
      { signal: input.signal, timeoutMs: READ_CONFIG_TIMEOUT_MS },
    );

    let parsed: unknown;
    try {
      // `callAgentaTool` hands back the tool result's `content`, which for this op is the same
      // `ReadConfigResponse` object the route used to return as its body.
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("the configuration read returned a malformed response");
    }
    const answer = (parsed ?? {}) as Record<string, unknown>;

    // The answer describes the head. If that is not the base the operation names, the runner
    // cannot show what this commit would replace, so it refuses rather than diffing against the
    // wrong side.
    if (answer.base_revision_id !== revisionId) {
      throw new Error(
        `the configuration moved to revision ${String(answer.base_revision_id)} while this commit targets ${revisionId}`,
      );
    }
    if (typeof answer.value !== "string") {
      // A `set` from a file replaces a field that already holds a string. A non-string here
      // means the target does not name such a field, and a diff would be meaningless.
      throw new Error(
        "the target field does not currently hold text, so there is nothing to show it replacing",
      );
    }
    return answer.value;
  };
}
