/**
 * The private gateway policy: the runner's own answer to "may this integration tool run, and
 * what may the model see".
 *
 * The two derived runtime tools (`search_tools` / `run_tool`) carry `permission: "allow"` on
 * their specifications. That coarse value only opens the harness gate so the call reaches the
 * runner at all — WITHOUT it every gateway call would raise a meaningless second card named
 * `run_tool` and a compiled `allow` would never run unprompted. The authorization boundary is
 * here: a semantic gate keyed on the `gateway.run` call reference, applied at the relay
 * execution seam that every delivery path passes through (Pi's extension, the local loopback
 * MCP server, and the in-sandbox shim all reach the provider through a relay request file).
 *
 * This module is pure. It decides and it filters; the seam that owns the pause and the
 * callback lives in `relay.ts` and `engines/sandbox_agent/gateway-gate.ts`.
 *
 * Three rules shape the messages below.
 *
 *  - A refusal never enumerates. A model that is told "GET_ISSUE, LIST_ISSUES and CREATE_ISSUE
 *    are available" has been handed the policy table one probe at a time, and a refusal that
 *    names an integration the agent never configured confirms it exists. So an unconfigured
 *    integration, an unknown tool key and a compiled `deny` all answer with the SAME sentence.
 *  - Search is the one exception, and only for CONFIGURED integrations: naming the agent's own
 *    connected apps is what makes a mistyped `integration` argument correctable.
 *  - The model never supplies routing. The provider and the connection are read here, from the
 *    resolved policy, and travel as private callback context.
 */
import type { ToolPermission } from "../protocol.ts";
import { isToolPermission } from "../permission-plan.ts";
import type { ExecutableToolVerdict } from "./executable-tool-gate.ts";

/** The two stable call references. They carry no integration, connection, action, or policy. */
export const GATEWAY_SEARCH_CALL_REF = "gateway.search";
export const GATEWAY_RUN_CALL_REF = "gateway.run";

/** At most this many search results reach the model, however many the provider returned. */
export const MAX_SEARCH_RESULTS = 5;

/** At most this many close-key suggestions survive sanitizing (the API's own cap). */
export const MAX_RUN_SUGGESTIONS = 5;

/**
 * Returned when search succeeded but nothing configured and non-denied survived the filter.
 *
 * It names the connected apps because an empty answer is exactly where the model has lost
 * the thread: without them it guesses at an integration the agent may not even have. Only
 * integration NAMES, never a connection slug — those are the agent's own apps, which the
 * prompt guidance already lists, so naming them here tells the model nothing new.
 */
export function emptySearchMessage(connected: readonly string[]): string {
  if (connected.length === 0) {
    return "No configured tool matched this request. Try a more specific task description.";
  }
  return (
    "No configured tool matched. Connected integrations: " +
    `${connected.join(", ")}. Try a more specific description or name one of them.`
  );
}

/**
 * The search-failure envelope. The runner writes this itself when the API answers with
 * something that is not the search result object, so unparsed provider text never reaches
 * the model on this path.
 */
export const TOOL_SEARCH_UNAVAILABLE_ERROR = {
  code: "tool_search_unavailable",
  message: "Tool search is temporarily unavailable.",
  retryable: true,
  next_step: "Retry the search once.",
} as const;

export interface NormalizedGatewayTool {
  permission: ToolPermission;
  readOnly: boolean | null;
}

export interface NormalizedGatewayIntegration {
  provider: string;
  connection: string;
  tools: Record<string, NormalizedGatewayTool>;
}

/**
 * The brand. It exists because `NormalizedGatewayPolicy` is otherwise STRUCTURALLY identical to
 * the wire `GatewayPolicy`, and TypeScript compares shapes, not names — so without it the type
 * distinction reads like enforcement while enforcing nothing, and a raw wire policy would
 * satisfy every decision function's signature.
 *
 * Only `normalizeGatewayPolicy` produces this symbol, so the type now means "this value came
 * through intake" rather than "this value has the right fields".
 */
declare const NORMALIZED_GATEWAY_POLICY: unique symbol;

/**
 * A policy that has been through intake. Every decision function below takes this and nothing
 * else, so an unvalidated `gatewayPolicy` cannot be consulted by accident: `tsc` rejects it.
 * `tests/unit/gateway-policy-intake.test.ts` proves that with `@ts-expect-error`.
 */
export interface NormalizedGatewayPolicy {
  readonly [NORMALIZED_GATEWAY_POLICY]: true;
  integrations: Record<string, NormalizedGatewayIntegration>;
}

/**
 * Read one key WITHOUT reaching the prototype chain.
 *
 * A plain object literal answers `map["toString"]` with a function it inherited from
 * `Object.prototype`, and a truthy answer is all a lookup needs to conclude "configured". That
 * was live: an integration named `toString` resolved to a truthy entry whose `permission` was
 * `undefined`, which then fell through to the run's DEFAULT permission — so under a default of
 * `allow` the gate ran a tool no one configured. `constructor` did the same to search, and
 * produced a callback context with no provider in it.
 *
 * Every lookup in this module goes through here. The maps below are also built with a null
 * prototype, so there is nothing to inherit in the first place; this is the second lock, for a
 * normalized policy that some future call site builds by hand.
 */
function ownEntry<T>(
  table: Record<string, T> | undefined,
  key: string,
): T | undefined {
  if (!table || !Object.hasOwn(table, key)) return undefined;
  return table[key];
}

/** A map that cannot answer for a key nobody put in it. */
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Validate and normalize the WHOLE policy once, at intake.
 *
 * Every consumer downstream — the gate, the search filter, the suggestion sanitizer, the
 * callback context — reads the result of this function and nothing else, so an entry that does
 * not survive here cannot be reached by any of them. That is the point: the alternative, each
 * consumer checking the fields it happens to use, is how a missing `connection` reaches a
 * callback while a missing `permission` quietly passes a filter written as "anything but deny".
 *
 * What is required, and why each one is fatal to its entry:
 *
 *  - A non-empty `provider` and `connection`. They are ROUTING. An integration missing either
 *    cannot be executed against, and sending a partial context to the API is a fail-open path.
 *  - A `permission` that is exactly `allow`, `ask`, or `deny`. Anything else — absent, `null`,
 *    `"inherit"` that escaped the compiler, a typo — is not a decision, and a non-decision must
 *    never be read as permission.
 *  - A `readOnly` that is exactly `true`, `false`, or `null`. Absent normalizes to `null`
 *    (unknown), which is a real value on this wire; any other type means the entry is not the
 *    shape it claims to be.
 *
 * An integration whose tools all fail validation is dropped whole. It has no runnable tool and
 * no searchable surface, so keeping it would only let a refusal name it.
 */
export function normalizeGatewayPolicy(raw: unknown): NormalizedGatewayPolicy {
  // Null-prototype maps: `integrations["toString"]` must be a miss, not an inherited function.
  const integrations = emptyMap<NormalizedGatewayIntegration>();
  const branded = { integrations } as NormalizedGatewayPolicy;
  // `unknown`, not `GatewayPolicy`, on purpose: this is the intake for wire data, and the wire
  // type is a claim about what the SDK sent, not a guarantee about what arrived. Typing the
  // parameter as the happy shape would make every test of a malformed policy uncompilable —
  // which is the same as having no such test.
  const rawIntegrations: unknown = isRecord(raw) ? raw.integrations : undefined;
  if (!isRecord(rawIntegrations)) return branded;

  // `Object.entries` walks own enumerable keys only, so a key the sender inherited never enters
  // the table. Combined with the null prototype above, the table holds exactly what was sent.
  for (const [rawKey, rawEntry] of Object.entries(rawIntegrations)) {
    const key = nonEmptyString(rawKey);
    if (!key || !isRecord(rawEntry)) continue;
    const provider = nonEmptyString(rawEntry.provider);
    const connection = nonEmptyString(rawEntry.connection);
    if (!provider || !connection) continue;

    const tools = emptyMap<NormalizedGatewayTool>();
    if (isRecord(rawEntry.tools)) {
      for (const [rawToolKey, rawTool] of Object.entries(rawEntry.tools)) {
        const toolKey = nonEmptyString(rawToolKey);
        if (!toolKey || !isRecord(rawTool)) continue;
        if (!isToolPermission(rawTool.permission)) continue;
        const readOnly = normalizedReadOnly(rawTool.readOnly);
        if (readOnly === INVALID_READ_ONLY) continue;
        tools[toolKey] = { permission: rawTool.permission, readOnly };
      }
    }
    if (Object.keys(tools).length === 0) continue;
    integrations[key] = { provider, connection, tools };
  }
  return branded;
}

/** Sentinel for a `readOnly` that is neither `true`, `false`, `null`, nor absent. */
const INVALID_READ_ONLY = Symbol("invalid-readOnly");

function normalizedReadOnly(
  value: unknown,
): boolean | null | typeof INVALID_READ_ONLY {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  return INVALID_READ_ONLY;
}

/**
 * The permissions a tool may still be REACHED under, as an allowlist.
 *
 * Written as "these two" rather than "anything except deny" deliberately. The exclusion form
 * reads the same today and fails open the moment an unexpected value reaches it — which is
 * exactly the shape normalization above exists to prevent, so the two guards agree.
 */
function isReachablePermission(permission: ToolPermission): boolean {
  return permission === "allow" || permission === "ask";
}

/** Private routing the runner adds beside the model's arguments (contracts section 6). */
export interface GatewayCallContext {
  provider: string;
  integration?: string;
  connection?: string;
  tool?: string;
}

/** What `run_tool` was asked to do, once the shape has been checked. */
export interface GatewayRunTarget {
  integration: string;
  tool: string;
  arguments: Record<string, unknown>;
}

/** A checked, policy-resolved `gateway.run` call, or the refusal the model must read. */
export type GatewayRunPlan =
  | {
      ok: true;
      permission: ToolPermission;
      readOnly: boolean | null;
      target: GatewayRunTarget;
      context: GatewayCallContext;
      /** `integration.TOOL_KEY` — what a person approves, and what the logs name. */
      display: string;
    }
  | { ok: false; reason: string };

/** A checked `gateway.search` call, or the refusal the model must read. */
export type GatewaySearchPlan =
  | {
      ok: true;
      /** The model's own arguments, narrowed to the two the contract defines. */
      arguments: Record<string, unknown>;
      context: GatewayCallContext;
    }
  | { ok: false; reason: string };

/**
 * The one refusal for a tool the agent cannot run, whatever the reason.
 *
 * Deliberately identical for an unconfigured integration, an unknown key, and a compiled
 * `deny`: three distinguishable messages let a model map the policy by probing, and the
 * difference changes nothing it can do next.
 */
export function gatewayToolUnavailableText(): string {
  return (
    "That tool is not available to this agent. This does not change while the conversation " +
    "continues, and no argument makes it available. Do not send this call again. Call " +
    "`search_tools` to find a tool this agent can run, or tell the user the action is " +
    "unavailable and ask what they would like to do instead."
  );
}

/** A malformed `run_tool` payload. The model can fix this one, so the text says how. */
function malformedRunCallText(problem: string): string {
  return (
    `This 'run_tool' call was not sent: ${problem} Call \`run_tool\` with \`integration\` ` +
    "and `tool` exactly as `search_tools` returned them, and `arguments` as a JSON object " +
    "matching the returned input schema."
  );
}

/**
 * Resolve one `gateway.run` call against the policy.
 *
 * The shape is checked BEFORE anything is decided, because a forged relay file can carry a
 * string or an array where the nested `arguments` object belongs: the existing required-argument
 * check tests presence only, so without this a malformed call reaches the approval card with
 * input the schema would reject. Refuse it before a person is asked, never after.
 *
 * The operator kill-switch is NOT read here. It rides `effectivePermission`, which the gate
 * seam calls with the permission this function returns, so one live check covers every tool
 * family instead of one per call site.
 */
export function planGatewayRun(
  args: unknown,
  policy: NormalizedGatewayPolicy,
): GatewayRunPlan {
  if (!isRecord(args)) {
    return {
      ok: false,
      reason: malformedRunCallText("its arguments were not a JSON object."),
    };
  }
  const integration = nonEmptyString(args.integration);
  if (!integration) {
    return {
      ok: false,
      reason: malformedRunCallText(
        "`integration` was missing or not a string.",
      ),
    };
  }
  const tool = nonEmptyString(args.tool);
  if (!tool) {
    return {
      ok: false,
      reason: malformedRunCallText("`tool` was missing or not a string."),
    };
  }
  // A plain object, on EVERY path. `null`, an array, a string and a number all fail here.
  if (!isRecord(args.arguments)) {
    return {
      ok: false,
      reason: malformedRunCallText(
        "`arguments` was not a JSON object of the tool's own inputs.",
      ),
    };
  }

  // A missing integration and a missing tool key are both `deny`, and so is an entry that did
  // not survive normalization. Fail closed: the absence of a rule is never permission.
  const entry = ownEntry(policy.integrations, integration);
  const toolPolicy = ownEntry(entry?.tools, tool);
  // The permission is re-checked even though intake guarantees it: this is the value that
  // becomes the gate's `specPermission`, and an `undefined` there falls through to the run's
  // DEFAULT permission rather than denying. That is the shape the prototype bug exploited.
  if (!entry || !toolPolicy || !isToolPermission(toolPolicy.permission)) {
    return { ok: false, reason: gatewayToolUnavailableText() };
  }

  return {
    ok: true,
    permission: toolPolicy.permission,
    readOnly: toolPolicy.readOnly,
    target: { integration, tool, arguments: args.arguments },
    // Routing the model can never supply: read from the resolved policy, sent as context.
    context: {
      provider: entry.provider,
      integration,
      connection: entry.connection,
      tool,
    },
    display: `${integration}.${tool}`,
  };
}

/**
 * Resolve one `gateway.search` call against the policy.
 *
 * An integration the agent never configured is rejected HERE, before the callback, because only
 * the runner holds the configured set — the API would happily search a provider toolkit the
 * agent has no connection to. This message does name the connected integrations: they are the
 * agent's own apps, and without them a mistyped argument is not correctable.
 */
export function planGatewaySearch(
  args: unknown,
  policy: NormalizedGatewayPolicy,
): GatewaySearchPlan {
  const configured = Object.keys(policy.integrations);
  if (configured.length === 0) {
    return { ok: false, reason: gatewayToolUnavailableText() };
  }
  const record = isRecord(args) ? args : {};
  const query = nonEmptyString(record.query);
  if (!query) {
    return {
      ok: false,
      reason:
        "This 'search_tools' call was not sent: `query` must be a non-empty description of " +
        "the task you want to perform. Search again with a concrete task description.",
    };
  }

  const rawIntegration = record.integration;
  if (rawIntegration !== undefined && rawIntegration !== null) {
    const integration = nonEmptyString(rawIntegration);
    const named = integration
      ? ownEntry(policy.integrations, integration)
      : undefined;
    if (!integration || !named) {
      return {
        ok: false,
        reason:
          `This agent is not connected to '${String(rawIntegration)}'. Connected ` +
          `integrations: ${configured.join(", ")}. Search again without \`integration\`, ` +
          "or name one of those.",
      };
    }
    return {
      ok: true,
      arguments: { query, integration },
      context: { provider: named.provider, integration },
    };
  }

  // Unscoped search. V1 configures one provider, so the first entry's provider routes the call.
  const first = ownEntry(policy.integrations, configured[0]);
  if (!first) return { ok: false, reason: gatewayToolUnavailableText() };
  return {
    ok: true,
    arguments: { query },
    context: { provider: first.provider },
  };
}

/** One `gateway.run` call presented to the gate, after its shape and policy were resolved. */
export interface GatewayGateRequest {
  /** The interaction token, when this call parks. */
  id: string;
  toolCallId: string;
  /** The coarse tool name (`run_tool`), which is what the approval identity keys on. */
  toolName: string;
  /**
   * The FULL outer arguments, `{integration, tool, arguments}`. Kept whole on purpose: the
   * shared `approvedCallKey` hashes the tool name plus these arguments, and the integration and
   * the tool key are inside them, so two integration tools already produce two identities. A
   * gateway-specific keying scheme would sit beside the one warm-session resume depends on.
   */
  input: unknown;
  plan: Extract<GatewayRunPlan, { ok: true }>;
}

/** The same three outcomes the loopback MCP gate returns; one union, so they cannot drift. */
export type GatewayGateVerdict = ExecutableToolVerdict;

/**
 * The pause-capable half of the gate. The relay seam can execute or refuse on its own, but it
 * cannot create a Sessions interaction or end a turn, so a forged relay call that compiles to
 * `ask` would either run or be refused outright — and neither is correct. This is the turn's
 * responder and pause wiring, handed down to the seam.
 */
export interface GatewayToolGate {
  onGatewayRun: (request: GatewayGateRequest) => Promise<GatewayGateVerdict>;
  onPause?: () => void;
}

/** Why each dropped search result was dropped, for the one structured log line. */
export interface SearchFilterDrops {
  unconfigured: number;
  unknownTool: number;
  denied: number;
  schema: number;
  capped: number;
}

export interface SearchFilterOutcome {
  /** The JSON payload written back to the harness, in place of the API's own body. */
  payload: string;
  total: number;
  kept: number;
  /**
   * `integration.TOOL` for each surviving result, in the order the model sees them. Kept so the
   * gate can report which rank the model then ran, which is the measurement that says whether
   * search is actually steering the model or whether it is guessing.
   */
  offered: string[];
  drops: SearchFilterDrops;
  /** True when the body was not the search result object and the failure envelope was written. */
  unparsable: boolean;
}

/**
 * Filter one `gateway.search` SUCCESS body against the policy and rebuild it.
 *
 * Scoped to this one call reference on purpose. `gateway.run` on success keeps its pass-through
 * path, and nothing here is a general result-processing pipeline.
 *
 * Each surviving result is REBUILT from a fixed field list rather than edited in place, so a
 * field the API adds later (a connection slug, a provider account ID, a provider action ID, a
 * permission value, a `read_only` hint) cannot reach the model by default.
 */
export function filterGatewaySearchResult(
  raw: string,
  policy: NormalizedGatewayPolicy,
): SearchFilterOutcome {
  const drops: SearchFilterDrops = {
    unconfigured: 0,
    unknownTool: 0,
    denied: 0,
    schema: 0,
    capped: 0,
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unparsableSearch(drops);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return unparsableSearch(drops);
  }

  const total = parsed.results.length;
  const kept: Record<string, unknown>[] = [];
  for (const entry of parsed.results) {
    if (!isRecord(entry)) {
      drops.schema += 1;
      continue;
    }
    const integration = nonEmptyString(entry.integration);
    const tool = nonEmptyString(entry.tool);
    const configured = integration
      ? ownEntry(policy.integrations, integration)
      : undefined;
    if (!integration || !configured) {
      drops.unconfigured += 1;
      continue;
    }
    const toolPolicy = tool ? ownEntry(configured.tools, tool) : undefined;
    if (!tool || !toolPolicy) {
      drops.unknownTool += 1;
      continue;
    }
    // An allowlist, not "anything except deny". See `isReachablePermission`.
    if (!isReachablePermission(toolPolicy.permission)) {
      drops.denied += 1;
      continue;
    }
    if (!isUsableObjectSchema(entry.input_schema)) {
      drops.schema += 1;
      continue;
    }
    if (kept.length >= MAX_SEARCH_RESULTS) {
      drops.capped += 1;
      continue;
    }
    kept.push({
      integration,
      tool,
      name: typeof entry.name === "string" ? entry.name : tool,
      ...(typeof entry.description === "string"
        ? { description: entry.description }
        : {}),
      input_schema: entry.input_schema,
    });
  }

  // Descriptions are provider prose, and the provider writes them against its OWN catalog — so a
  // permitted tool's description cheerfully names alternatives the agent may not run ("use
  // GMAIL_SEND_EMAIL to send it immediately"). Filtering the RESULTS therefore does not finish
  // the job: the enumeration every refusal here avoids walks straight back in through the text
  // of a result that passed. Redact once the kept set is known, so a token is judged against
  // what this very response permits.
  const byToken = keptToolTokenMap(
    kept as unknown as { integration: string; tool: string }[],
  );
  for (const entry of kept) {
    if (typeof entry.description === "string") {
      entry.description = redactUnpermittedToolTokens(
        entry.description,
        byToken,
      );
    }
    // The argument descriptions carry the same cross-references, and are the prose a model
    // reads hardest when building the call. Same map, so a token is judged against what this
    // very response permits.
    redactUnpermittedTokensInSchema(entry.input_schema, byToken);
  }

  // Always, and on both branches: the model needs to know what it is connected to most
  // when search came back empty, but a partial answer is the other place it drifts toward
  // an app the agent does not have. Names only, from the policy keys, so no slug and no
  // permission value can ride along.
  const connected = Object.keys(policy.integrations).sort();
  const body =
    kept.length > 0
      ? { results: kept, connected_integrations: connected }
      : {
          results: [],
          message: emptySearchMessage(connected),
          connected_integrations: connected,
        };
  return {
    payload: JSON.stringify(body),
    total,
    kept: kept.length,
    offered: kept.map((entry) => `${entry.integration}.${entry.tool}`),
    drops,
    unparsable: false,
  };
}

/**
 * Drop close-key suggestions the agent may not run from a `gateway.run` error envelope.
 *
 * The API builds that list from the WHOLE integration catalog, because it does not hold the
 * agent's policy. Left alone it tells the model the exact names of the tools it is forbidden
 * to run, which is the enumeration every refusal here avoids. A field edit on an error payload,
 * not result transformation: any other code, and any body that is not this envelope, passes
 * through untouched.
 */
export function sanitizeGatewayRunError(
  content: string,
  integration: string,
  policy: NormalizedGatewayPolicy,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (!isRecord(parsed) || parsed.code !== "tool_not_found") return content;
  const details = parsed.details;
  if (!isRecord(details) || !Array.isArray(details.suggestions)) return content;

  const tools = ownEntry(policy.integrations, integration)?.tools;
  const allowed = details.suggestions
    .filter((key): key is string => typeof key === "string")
    // An allowlist: a key survives only when the policy holds a decision OF ITS OWN for it, and
    // that decision still lets the model reach the tool.
    .filter((key) => {
      const decision = ownEntry(tools, key);
      return (
        decision !== undefined && isReachablePermission(decision.permission)
      );
    })
    .slice(0, MAX_RUN_SUGGESTIONS);

  const nextDetails: Record<string, unknown> = { ...details };
  if (allowed.length > 0) nextDetails.suggestions = allowed;
  else delete nextDetails.suggestions;

  const next: Record<string, unknown> = { ...parsed };
  if (Object.keys(nextDetails).length > 0) next.details = nextDetails;
  else delete next.details;
  return JSON.stringify(next);
}

function unparsableSearch(drops: SearchFilterDrops): SearchFilterOutcome {
  return {
    payload: JSON.stringify(TOOL_SEARCH_UNAVAILABLE_ERROR),
    total: 0,
    kept: 0,
    offered: [],
    drops,
    unparsable: true,
  };
}

/**
 * A canonical provider action id as it appears inside prose: SCREAMING_SNAKE_CASE with at least
 * one underscore. The underscore is what makes this narrow enough to run over free text — it
 * leaves ordinary shouted words (HTML, JSON, URL, API) alone, because none of them carry one.
 */
const PROVIDER_ACTION_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** What replaces a redacted token: shorter than the name, and obviously not a name. */
export const REDACTED_TOOL_TOKEN = "…";

/**
 * Rewrite the provider action ids in one description so every one the model reads is a key it can
 * actually pass to `run_tool`, and every one it cannot is gone.
 *
 * Two branches, and the KEEP branch is the one that bites. Provider prose names its own catalog
 * ids, which are prefixed (`GMAIL_FETCH_EMAILS`), while the key `run_tool` accepts is the bare
 * catalog key (`FETCH_EMAILS`). Passing the prefixed form through unchanged reads to a model
 * exactly like a usable tool key — so it calls `run_tool` with it, the gate does not find it, and
 * the call is refused. Measured as a weak-model task failure in live QA, on a tool the agent was
 * PERMITTED to run. So a mention of a kept tool is rewritten to that tool's own key.
 *
 * The drop branch is unchanged: a token matching no kept tool becomes an ellipsis, so a denied
 * key, an unconfigured integration's key, and a key that simply did not make the cut all read
 * alike. Deliberately NOT a general scrubber — one token shape, one question.
 *
 * `byToken` maps every form a kept tool may appear as to the key the model should see; build it
 * with `keptToolTokenMap`.
 */
export function redactUnpermittedToolTokens(
  description: string,
  byToken: ReadonlyMap<string, string>,
): string {
  return description.replace(
    PROVIDER_ACTION_TOKEN,
    (token) => byToken.get(token) ?? REDACTED_TOOL_TOKEN,
  );
}

/**
 * Rewrite the provider action ids in a tool's SCHEMA prose, in place.
 *
 * The top-level description is not the only prose a model reads — the argument descriptions are
 * where it looks hardest when filling a call, and providers put the same cross-references there
 * ("use GMAIL_LIST_DRAFTS to retrieve valid draft IDs, or GMAIL_SEND_EMAIL to send directly").
 * Live QA on 2026-08-27 found a DENIED tool named in a `draft_id` description of a permitted
 * result, and the prefixed form is not a key `run_tool` accepts, so a model copying it fails.
 *
 * THE RULE: rewrite the prose a reader READS (`description`, `title`, string `examples`); never
 * the values a caller SENDS (`enum`, `default`, `const`, property keys, types).
 *
 * `examples` sits on the prose side, which is worth stating because it looks like data. The
 * values a model copies out of a gateway tool's argument schema are the provider's own
 * parameters — `draft_id`, `subject`, `thread_id` — never an action id: the action id travels in
 * `run_tool`'s `tool` field and never comes from a schema example. So a field whose legitimate
 * value is an action id essentially does not occur here, while an example string offering a
 * denied tool id is the same trap as the sentence above it.
 */
export function redactUnpermittedTokensInSchema(
  node: unknown,
  byToken: ReadonlyMap<string, string>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) redactUnpermittedTokensInSchema(item, byToken);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (
      (key === "description" || key === "title") &&
      typeof value === "string"
    ) {
      record[key] = redactUnpermittedToolTokens(value, byToken);
      continue;
    }
    if (key === "examples" && Array.isArray(value)) {
      record[key] = value.map((item) =>
        typeof item === "string"
          ? redactUnpermittedToolTokens(item, byToken)
          : item,
      );
      continue;
    }
    redactUnpermittedTokensInSchema(value, byToken);
  }
}

/**
 * The token → key map for one response's kept results.
 *
 * A provider writes the same tool as `FETCH_EMAILS` in one sentence and `GMAIL_FETCH_EMAILS` in
 * the next, so both forms map to the bare key. The prefixed form is derived from the result's own
 * integration rather than guessed, and only for results this response actually kept — which is
 * what keeps the keep branch from resurrecting a tool the filter dropped.
 */
export function keptToolTokenMap(
  kept: readonly { integration: string; tool: string }[],
): Map<string, string> {
  const byToken = new Map<string, string>();
  for (const { integration, tool } of kept) {
    const upper = integration.toUpperCase();
    byToken.set(tool, tool);
    byToken.set(`${upper}_${tool}`, tool);
    // Composio strips hyphens from the integration when it builds the prose form, so
    // `google-calendar` is written `GOOGLECALENDAR_CREATE_EVENT`. Without this entry a
    // hyphenated integration never matches its own prefixed mention and the tool's own
    // name is REDACTED out of the prose describing it. It fails closed, so it costs
    // legibility rather than safety — but the model then reads a description with a hole
    // where the tool it is being offered should be.
    const squashed = upper.replace(/-/g, "");
    if (squashed !== upper) byToken.set(`${squashed}_${tool}`, tool);
  }
  return byToken;
}

/**
 * Whether a result carries an input schema the model can actually call the tool with. An
 * explicit non-object type is unusable, and so is a bare `{}` with neither a type nor
 * properties: both leave the model guessing at the argument shape.
 */
function isUsableObjectSchema(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.type !== undefined) return schema.type === "object";
  return isRecord(schema.properties);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
