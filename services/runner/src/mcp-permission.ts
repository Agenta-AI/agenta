/**
 * MCP permission intake and resolution: the one place the wire's permission fields become
 * decisions.
 *
 * This module is imported by BOTH sides — the runner (`engines/sandbox_agent/runtime-policy.ts`,
 * which resolves gates for the ACP harnesses) and the in-sandbox Pi extension (`extensions/pi-mcp.ts`,
 * bundled by esbuild) — so the rule cannot drift between the harness families the way it did before
 * OR79. Keep it dependency-free (no node built-ins, no imports beyond types) so it bundles cleanly
 * into the extension.
 *
 * Keys are the names the SERVER advertises. Every harness renders its own tool name from them
 * (`mcp__<server>__<tool>`, `mcp.<server>.<tool>`, and Pi's own lossy rewrite), so a table keyed on
 * any rendered spelling misses on at least one harness. See OR80.
 */

/** The three verdicts. Duplicated from `protocol.ts` as a value rather than imported as a type,
 *  so this module stays importable by the extension bundle. */
const VERDICTS = ["allow", "ask", "deny"] as const;

export type McpPermission = (typeof VERDICTS)[number];

export function isMcpPermission(value: unknown): value is McpPermission {
  return (VERDICTS as readonly unknown[]).includes(value);
}

/** How the SDK model and the editor spell the two per-tool fields. The wire, which this module
 *  reads, spells them `toolPermissions` and `newToolPermission`. */
const MODEL_PER_TOOL_FIELDS = ["tool_permissions", "new_tool_permission"] as const;

/** One MCP server's resolved permission table, after intake. */
export interface McpServerPermissions {
  /** The whole-server decision, when the author set a readable one. */
  server?: McpPermission;
  /** Per-tool decisions by upstream tool name. Empty unless the author opted in. */
  tools: ReadonlyMap<string, McpPermission>;
  /**
   * The decision an advertised tool gets when `tools` has no entry for it. Present exactly when
   * the author opted into per-tool policy, and authoritative when present — see
   * `mcpToolPermission`.
   */
  newTool?: McpPermission;
  /**
   * More than one configured server answers to this name, so no call under it can be attributed
   * to a connection. Set at intake, and the only field `mcpToolPermission` reads when it is set:
   * see there for why this refuses rather than resolving.
   */
  ambiguous?: true;
}

export type McpPermissionTable = ReadonlyMap<string, McpServerPermissions>;

/**
 * Validate one server's raw `policy` object into a table.
 *
 * Modelled on `tools/gateway-policy.ts`'s `normalizeGatewayPolicy`, and for the same reason: every
 * consumer downstream reads the result of this function and nothing else, so an entry that does
 * not survive here cannot be reached by any of them. The alternative — each call site checking the
 * fields it happens to use — is how a `permission` of `"Deny"` or `null` quietly passes a filter
 * written as "anything but deny".
 *
 * Three rules, and the third is the one that matters:
 *
 *  - A `permission` that is not exactly `allow`/`ask`/`deny` is not a decision, so it is dropped
 *    and the server falls to the run's own permission ladder. That is what an ABSENT permission
 *    already does, so a malformed one is never more permissive than saying nothing.
 *  - A malformed `toolPermissions` entry is dropped and falls to `newTool`, which is itself a real
 *    decision whenever the author opted in.
 *  - An author who opted in but whose `newToolPermission` or `toolPermissions` is PRESENT AND
 *    CORRUPT gets `deny`. The wire is misdescribing its own shape at that point, and the runner
 *    must not guess a floor on behalf of someone who asked for a restriction. Opting in is read
 *    from what the sender DECLARED rather than from what parsed, so a corrupt container cannot
 *    take the whole table down with it (D9). An OMITTED `newToolPermission` beside a readable
 *    table is a different thing — an older or hand-written sender, not a corrupt one — and gets
 *    `ask`, so a human decides rather than a parser.
 */
export function normalizeMcpServerPermissions(
  rawPolicy: unknown,
): McpServerPermissions {
  const policy = isRecord(rawPolicy) ? rawPolicy : {};

  // A per-tool table under the MODEL's field names is a table this reader cannot see: it reads
  // the wire's names, and the wire type is a free-form mapping, so nothing upstream rejects the
  // other spelling. Read on, and the table vanishes while `permission` survives, so a server
  // marked `allow` runs every tool the table denied, unapproved (issue 6917).
  //
  // So the policy is refused rather than read: `ask` for every tool, and the whole-server
  // permission is dropped with the rest, because falling back to it is the one answer that
  // cannot be right. Narrow on purpose — only the two aliases of the per-tool fields, not any
  // unknown key — so a policy carrying a field this runner's image predates still works.
  //
  // `ask` rather than the `deny` its declared-and-corrupt neighbour below gives: nothing here
  // says which restriction the author asked for, only that they asked for one, and a human
  // answering each call is the smallest thing that cannot be wrong.
  if (MODEL_PER_TOOL_FIELDS.some((field) => field in policy)) {
    return { tools: new Map(), newTool: "ask" };
  }

  // A Map, not an object literal: `{}["toString"]` answers with an inherited function, and a
  // truthy answer is all a lookup needs to conclude "configured". That exact shape was a live
  // defect on the Composio side (`tools/gateway-policy.ts`, `ownEntry`).
  const tools = new Map<string, McpPermission>();
  const rawTools = policy.toolPermissions;
  if (isRecord(rawTools)) {
    // `Object.entries` walks own enumerable keys only, so a key the sender inherited never enters.
    for (const [tool, permission] of Object.entries(rawTools)) {
      if (!tool.trim() || !isMcpPermission(permission)) continue;
      tools.set(tool, permission);
    }
  }

  // What the sender DECLARED, not what parsed. A declared-and-corrupt field is a sender
  // misdescribing its own shape, and the one thing it must not do is vanish: reading intent off
  // the parse is how a `toolPermissions` that arrived as a string silently switched the whole
  // per-tool table back to the run default (D9).
  const declaredNewTool = "newToolPermission" in policy;
  const declaredTools = "toolPermissions" in policy;
  const optedIn = declaredNewTool || declaredTools;
  let newTool: McpPermission | undefined;
  if (optedIn) {
    if (isMcpPermission(policy.newToolPermission)) {
      newTool = policy.newToolPermission;
    } else if (declaredNewTool || (declaredTools && !isRecord(rawTools))) {
      // Declared and unreadable, on either field: deny. The author asked for a restriction and
      // the runner cannot tell which one, so it does not get to guess a floor on their behalf.
      newTool = "deny";
    } else {
      // A readable table with no floor beside it — an older or hand-written sender, not a corrupt
      // one. A human decides for anything the table does not name.
      newTool = "ask";
    }
  }

  return {
    ...(isMcpPermission(policy.permission)
      ? { server: policy.permission }
      : {}),
    tools,
    ...(newTool !== undefined ? { newTool } : {}),
  };
}

/**
 * The decision for one call, given its server's table and the UPSTREAM tool name.
 *
 * A per-tool table is authoritative for its server: once the author wrote one, an unlisted tool
 * gets `newTool` and the lookup stops. It deliberately does NOT fall through to the whole-server
 * permission or to the run default, because a per-tool policy a run default can widen is not a
 * policy — an agent configured `default: "allow"` would otherwise run every tool the author had
 * not got around to listing.
 *
 * With no table, this returns the whole-server permission, or `undefined` so the caller's existing
 * ladder (rules, then the run default) decides exactly as it did before per-tool policy existed.
 *
 * An AMBIGUOUS entry refuses outright, which is the same answer the ACP gate gives a rendered
 * tool name more than one configured server could claim (D2). Both are one situation — a call
 * that cannot be attributed to a connection — so they get one verdict, and it lives here because
 * this is the single place all three consumers read: the ACP gate, the Pi gate, and the Pi
 * extension's registration filter, which then declines to advertise the tool at all.
 *
 * Deferring instead would hand the call to the run's default permission, which is `allow_reads`
 * out of the box and may be an authored `allow`. The operator configured a policy for each
 * candidate; running under neither is not a choice this code gets to make.
 */
export function mcpToolPermission(
  entry: McpServerPermissions | undefined,
  tool: string | undefined,
): McpPermission | undefined {
  if (!entry) return undefined;
  if (entry.ambiguous) return "deny";
  if (entry.newTool === undefined) return entry.server;
  if (tool) {
    const named = entry.tools.get(tool);
    if (named !== undefined) return named;
  }
  return entry.newTool;
}

/** Exported so the Pi extension, which already imports this module, does not carry a second
 *  copy into the same bundle. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
