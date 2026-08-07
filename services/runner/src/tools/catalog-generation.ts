/**
 * The tool-catalog generation (slice S3b).
 *
 * Contract: docs/design/agent-config-editing/contracts/adapter-matrix.md 2.4, consumed by
 * execution-authorization.md 8.
 *
 * One opaque string per environment, captured when an execution authorization is minted and
 * compared to the live value when it is consumed. A mismatch fails the call closed.
 *
 * The reason is direct: a tool named `commit_revision` under generation N may have a different
 * schema, a different permission, or a different execution binding under generation N+1. An
 * approval minted under N does not describe the call that would run under N+1, so it must not
 * authorize one.
 *
 * The rule behind what is in the document and what is not: INCLUDE what changes the meaning of
 * a call; EXCLUDE what rotates. A field that changes on an ordinary turn (the callback
 * authorization, run-context VALUES, trace ids) must stay out, or every parked authorization
 * dies for no security gain and users re-approve constantly.
 */
import { createHash } from "node:crypto";

import type { ResolvedToolSpec } from "../protocol.ts";
import { strictCanonicalJson } from "./strict-canonical-json.ts";

/** Which code path runs the call. Changing it changes where the model's arguments go. */
export type DispatchKind = "direct" | "gateway" | "client" | "relay";

/** One tool's behavior-bearing identity. Every field is contract 2.4.1, in that order. */
interface GenerationEntry {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  readOnly: boolean | null;
  permission: string | null;
  dispatchKind: DispatchKind;
  dispatchTarget: string | null;
  contextBindings: Array<{ destinationPath: string; sourceToken: string }>;
  argsIntoPath: string | null;
  staticBodyDigest: string | null;
  timeoutMs: number | null;
}

export function dispatchKindOf(spec: ResolvedToolSpec): DispatchKind {
  if (spec.kind === "client") return "client";
  if (spec.call) return "direct";
  if (spec.callRef) return "gateway";
  return "relay";
}

/**
 * WHERE the call goes: method plus path template for a direct call, the `callRef` for a
 * gateway one. The template, never a resolved URL — the path parameters are per-call data.
 */
function dispatchTargetOf(spec: ResolvedToolSpec): string | null {
  if (spec.call) return `${spec.call.method} ${spec.call.path}`;
  return spec.callRef ?? null;
}

/**
 * The MAPPING, not the destinations. Hashing destination paths alone misses a real behavior
 * change: rewiring a binding from `$ctx.workflow.variant.id` to `$ctx.workflow.artifact.id` at
 * the same destination changes the argument the runner actually sends while the destination
 * list stays identical, so the generation would not move and a parked authorization would still
 * verify against a call that now targets a different workflow entity.
 *
 * The `sourceToken` is the literal `$ctx.` token, which is stable configuration. The resolved
 * VALUE is per-turn data and stays out (contract 2.4.2).
 */
function contextBindingsOf(
  spec: ResolvedToolSpec,
): Array<{ destinationPath: string; sourceToken: string }> {
  const source = spec.call?.context ?? spec.contextBindings;
  if (!source) return [];
  return Object.entries(source)
    .map(([destinationPath, sourceToken]) => ({ destinationPath, sourceToken }))
    .sort((a, b) => (a.destinationPath < b.destinationPath ? -1 : 1));
}

/** A digest of the server-fixed body fields: it captures a changed fixed field without
 *  copying it into the document. */
function staticBodyDigestOf(spec: ResolvedToolSpec): string | null {
  if (!spec.call?.body) return null;
  return createHash("sha256")
    .update(strictCanonicalJson(spec.call.body), "utf8")
    .digest("hex");
}

function entryOf(spec: ResolvedToolSpec): GenerationEntry {
  return {
    name: spec.name,
    description: spec.description ?? null,
    inputSchema: spec.inputSchema ?? null,
    readOnly: typeof spec.readOnly === "boolean" ? spec.readOnly : null,
    permission: spec.permission ?? null,
    dispatchKind: dispatchKindOf(spec),
    dispatchTarget: dispatchTargetOf(spec),
    contextBindings: contextBindingsOf(spec),
    argsIntoPath: spec.call?.args_into ?? null,
    staticBodyDigest: staticBodyDigestOf(spec),
    timeoutMs: spec.timeoutMs ?? null,
  };
}

/**
 * SHA-256 over the strict canonical serialization of the catalog document.
 *
 * The strict serializer, never the lenient `canonicalJson`: a tool description or a schema
 * default can be a JSON-looking string, and the lenient one would parse it, so two different
 * catalogs could share a generation.
 *
 * The document sorts by name, so a reordered input does not churn the generation, and the SET
 * of tools is part of it, so adding or removing a tool advances it even when no surviving tool
 * changed.
 */
export function computeCatalogGeneration(specs: ResolvedToolSpec[]): string {
  const document = {
    version: 1,
    tools: specs
      .map(entryOf)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
  return createHash("sha256")
    .update(strictCanonicalJson(document), "utf8")
    .digest("hex");
}
