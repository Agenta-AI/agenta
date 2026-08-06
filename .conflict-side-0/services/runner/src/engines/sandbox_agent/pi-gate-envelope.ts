/**
 * The Pi approval-gate envelope: the one sandbox-internal contract this feature adds.
 *
 * A Pi gate stops expressing an approval as a file-relay wait and raises it as
 * `ctx.ui.confirm(PI_GATE_DIALOG_TITLE, <envelope JSON>)` from inside the sandbox. The
 * `pi-acp` bridge forwards only the dialog strings (`{method, title, message}`) with a
 * synthetic `pi-ui-<uuid>` tool-call id, so the real gate identity (tool name, the model's
 * tool-call id, the arguments) is tunneled through the `message` field as this JSON envelope.
 * The runner parses it back into a real gate identity at the permission responder.
 *
 * This module is imported by BOTH sides — the in-sandbox extension (bundled by esbuild) and
 * the runner — so the build and parse stay one source of truth. Keep it dependency-free (no
 * node built-ins) so it bundles cleanly into the extension.
 *
 * Field roles (design-interfaces): `v`/`kind` are protocol context (version + discriminator so
 * an unrelated future `confirm` can never be misread as a gate); `gate` is routing (which gate
 * raised it); `toolName`/`toolCallId`/`input` are the gate identity (data). The envelope
 * carries identity ONLY, never policy — the runner recovers permission metadata from the run's
 * own resolved specs, because the sandbox is not trusted to state its own permissions.
 */

/** The fixed `ctx.ui.confirm` title, used as the cheap pre-filter for a Pi gate dialog. */
export const PI_GATE_DIALOG_TITLE = "agenta-approval";

/** The envelope version. A request whose title matches but whose version differs fails closed. */
export const PI_GATE_ENVELOPE_VERSION = 1;

/** The envelope discriminator, so a stray `confirm` from a future extension cannot misclassify. */
export const PI_GATE_ENVELOPE_KIND = "agenta.gate";

/** Which Pi gate raised the dialog. Routes the runner's `GateDescriptor.executor`. */
export type PiGateKind = "pi-builtin" | "pi-custom-tool";

export interface PiGateEnvelope {
  v: typeof PI_GATE_ENVELOPE_VERSION;
  kind: typeof PI_GATE_ENVELOPE_KIND;
  gate: PiGateKind;
  /** The tool name the decision map keys on (the builtin canonical name or the custom spec name). */
  toolName: string;
  /** The model's real tool-call id (NOT the bridge's synthetic `pi-ui-<uuid>`). */
  toolCallId: string;
  /** The call arguments, verbatim, so the approval card and the stored-decision key are exact. */
  input: unknown;
}

export interface BuildPiGateEnvelopeInput {
  gate: PiGateKind;
  toolName: string;
  toolCallId: string;
  input: unknown;
}

/** Serialize a gate identity into the dialog `message` string (extension side). */
export function buildPiGateEnvelope(input: BuildPiGateEnvelopeInput): string {
  const envelope: PiGateEnvelope = {
    v: PI_GATE_ENVELOPE_VERSION,
    kind: PI_GATE_ENVELOPE_KIND,
    gate: input.gate,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    input: input.input,
  };
  return JSON.stringify(envelope);
}

/**
 * The outcome of inspecting one ACP permission request for a Pi gate envelope:
 *  - `matched: false`   — the dialog title is not ours; not a Pi gate, take today's path.
 *  - `matched: true, envelope: undefined` — the title IS ours but the envelope did not parse;
 *    the caller MUST fail closed (reject), never fall through (a fallthrough under a
 *    default-allow plan would confirm an unapproved execution).
 *  - `matched: true, envelope` — parsed; classify from the identity.
 */
export type PiGateParseResult =
  { matched: false } | { matched: true; envelope?: PiGateEnvelope };

/** The dialog `message` string carried on an ACP permission request, or undefined. */
function gateMessageOf(request: unknown): string | undefined {
  const toolCall = (request as { toolCall?: unknown } | undefined)?.toolCall;
  const rawInput = (toolCall as { rawInput?: unknown } | undefined)?.rawInput;
  const message = (rawInput as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

/** The dialog title carried on an ACP permission request, or undefined. */
function gateTitleOf(request: unknown): string | undefined {
  const toolCall = (request as { toolCall?: unknown } | undefined)?.toolCall;
  const title = (toolCall as { title?: unknown } | undefined)?.title;
  return typeof title === "string" ? title : undefined;
}

/**
 * Strict, version-checked parse of an ACP permission request into a Pi gate envelope.
 *
 * The title is the pre-filter: a request whose title is not `PI_GATE_DIALOG_TITLE` is not our
 * gate (`matched: false`). A request whose title matches but whose envelope is malformed
 * (unparseable JSON, wrong `kind`/`v`, missing identity) returns `matched: true` with no
 * envelope so the caller fails closed.
 */
export function parsePiGateEnvelope(request: unknown): PiGateParseResult {
  if (gateTitleOf(request) !== PI_GATE_DIALOG_TITLE) return { matched: false };

  const message = gateMessageOf(request);
  if (message === undefined) return { matched: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { matched: true };
  }
  const envelope = validatePiGateEnvelope(parsed);
  return { matched: true, envelope };
}

function isPiGateKind(value: unknown): value is PiGateKind {
  return value === "pi-builtin" || value === "pi-custom-tool";
}

/** Return the envelope only when every required identity field is present and well-typed. */
function validatePiGateEnvelope(value: unknown): PiGateEnvelope | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.v !== PI_GATE_ENVELOPE_VERSION) return undefined;
  if (record.kind !== PI_GATE_ENVELOPE_KIND) return undefined;
  if (!isPiGateKind(record.gate)) return undefined;
  if (typeof record.toolName !== "string" || !record.toolName) return undefined;
  if (typeof record.toolCallId !== "string" || !record.toolCallId)
    return undefined;
  if (!("input" in record)) return undefined;
  return {
    v: PI_GATE_ENVELOPE_VERSION,
    kind: PI_GATE_ENVELOPE_KIND,
    gate: record.gate,
    toolName: record.toolName,
    toolCallId: record.toolCallId,
    input: record.input,
  };
}
