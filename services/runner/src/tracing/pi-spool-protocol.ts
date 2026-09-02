/** Bundle-safe protocol shared by the Pi extension and the runner-side spool consumer. */

export const PI_TRACE_CONTROL_VERSION = 1 as const;
export const PI_TRACE_CONTROL_FILE = "current.control.json";
export const PI_TRACE_CONTROL_ENV = "AGENTA_AGENT_TELEMETRY_CONTROL_PATH";
export const PI_TRACE_MAX_CONTROL_BYTES = 256 * 1024;
export const PI_TRACE_MAX_BATCH_BYTES = 8 * 1024 * 1024;
export const PI_TRACE_MAX_FILES = 4;
export const PI_TRACE_FILE_SUFFIX = ".otlp.pb";

const CHANNEL_ID_RE = /^[0-9a-f]{32}$/;

export interface PiTurnTraceControl {
  version: typeof PI_TRACE_CONTROL_VERSION;
  channelId: string;
  turnId?: string;
  sessionId?: string;
  propagation?: {
    traceparent?: string;
    baggage?: string;
  };
  capture: {
    content: boolean;
  };
  skills: string[];
  redaction: {
    knownValues: string[];
  };
}

export function isPiTraceChannelId(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_ID_RE.test(value);
}

export function piTraceFileName(channelId: string, sequence: number): string {
  return `${channelId}.${sequence}${PI_TRACE_FILE_SUFFIX}`;
}

export function isPiTraceSpoolFileName(name: string): boolean {
  if (name === PI_TRACE_CONTROL_FILE) return true;
  if (name.includes(`${PI_TRACE_FILE_SUFFIX}.tmp.`)) return true;
  const match = /^([0-9a-f]{32})\.(\d+)\.otlp\.pb$/.exec(name);
  return !!match;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Parse the sandbox-writable control file without accepting unbounded collections. */
export function parsePiTurnTraceControl(value: unknown): PiTurnTraceControl {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi trace control must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== PI_TRACE_CONTROL_VERSION) {
    throw new Error("Unsupported Pi trace control version");
  }
  if (!isPiTraceChannelId(raw.channelId)) {
    throw new Error("Pi trace control channelId is invalid");
  }
  const propagation =
    raw.propagation && typeof raw.propagation === "object"
      ? (raw.propagation as Record<string, unknown>)
      : undefined;
  const capture =
    raw.capture && typeof raw.capture === "object"
      ? (raw.capture as Record<string, unknown>)
      : undefined;
  const skills = Array.isArray(raw.skills)
    ? raw.skills
        .filter((item): item is string => typeof item === "string")
        .slice(0, 256)
    : [];
  const redaction =
    raw.redaction && typeof raw.redaction === "object"
      ? (raw.redaction as Record<string, unknown>)
      : undefined;
  const knownValues = Array.isArray(redaction?.knownValues)
    ? redaction.knownValues
        .filter((item): item is string => typeof item === "string")
        .slice(0, 256)
    : [];
  return {
    version: PI_TRACE_CONTROL_VERSION,
    channelId: raw.channelId,
    turnId: optionalString(raw.turnId),
    sessionId: optionalString(raw.sessionId),
    propagation: propagation
      ? {
          traceparent: optionalString(propagation.traceparent),
          baggage: optionalString(propagation.baggage),
        }
      : undefined,
    capture: { content: capture?.content !== false },
    skills,
    redaction: { knownValues },
  };
}
