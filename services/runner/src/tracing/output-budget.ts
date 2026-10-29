import { envInt } from "../env.ts";

const MODEL_STEP = "model";

type Step = { bytes: number; events: number; snapshot: number };

/** Bound admitted output before tracing, persistence and live delivery make copies of it.
 * The limit applies to each step (one model reply or one tool call), with a looser backstop for
 * the whole turn, so a long turn of normal steps finishes while one runaway step is still stopped.
 * A running tool resends its whole output so far on every progress update and only the last copy
 * is kept, so a progress update is charged only for the bytes it adds over its largest earlier
 * copy. An update that carries tool arguments is charged in full: the tracer records each new
 * set of arguments as its own event.
 * Counts wire bytes rather than claiming to measure heap use.
 * The transport has already decoded a single frame here; this is not a frame-size firewall.
 */
export function createOutputBudget(
  onExceeded?: (reason: string) => void,
  log: (line: string) => void = (line) => process.stderr.write(line),
): {
  accept(value: unknown): boolean;
} {
  const maxStepBytes = envInt(
    "AGENTA_RUNNER_OUTPUT_MAX_BYTES",
    16 * 1024 * 1024,
    { min: 1024, max: 256 * 1024 * 1024 },
  );
  const maxStepEvents = envInt("AGENTA_RUNNER_OUTPUT_MAX_EVENTS", 50_000, {
    min: 1,
    max: 1_000_000,
  });
  const maxTurnBytes = envInt(
    "AGENTA_RUNNER_OUTPUT_MAX_TURN_BYTES",
    64 * 1024 * 1024,
    { min: 1024, max: 1024 * 1024 * 1024 },
  );
  const maxTurnEvents = envInt(
    "AGENTA_RUNNER_OUTPUT_MAX_TURN_EVENTS",
    500_000,
    { min: 1, max: 10_000_000 },
  );
  const steps = new Map<string, Step>();
  let turnBytes = 0;
  let turnEvents = 0;
  let stopped = false;
  return {
    accept(value) {
      if (stopped) return false;
      const size = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
      const v = value as
        | {
            sessionUpdate?: unknown;
            toolCallId?: unknown;
            rawInput?: unknown;
            status?: unknown;
            type?: unknown;
            id?: unknown;
          }
        | null
        | undefined;
      // A new tool call ends the model reply that announced it.
      if (v?.sessionUpdate === "tool_call") steps.delete(MODEL_STEP);
      const acpToolId =
        v?.sessionUpdate === "tool_call" ||
        v?.sessionUpdate === "tool_call_update"
          ? v.toolCallId
          : undefined;
      const eventToolId =
        v?.type === "tool_call" || v?.type === "tool_result" ? v.id : undefined;
      const toolId = acpToolId ?? eventToolId;
      const key = toolId != null ? `tool:${String(toolId)}` : MODEL_STEP;
      // A harness may reuse the id of a finished call, so a new announcement starts a new step.
      if (v?.sessionUpdate === "tool_call" && toolId != null) steps.delete(key);
      const step = steps.get(key) ?? { bytes: 0, events: 0, snapshot: 0 };
      // The update that completes or fails a call is kept as its result, so it is charged in full.
      const progress =
        v?.sessionUpdate === "tool_call_update" &&
        acpToolId != null &&
        v.status !== "completed" &&
        v.status !== "failed" &&
        !hasToolArgs(v.rawInput);
      const charge = progress ? Math.max(0, size - step.snapshot) : size;

      const stepBreach =
        step.bytes + charge > maxStepBytes || step.events >= maxStepEvents;
      const breach =
        step.bytes + charge > maxStepBytes
          ? `step bytes > ${maxStepBytes}`
          : step.events >= maxStepEvents
            ? `step updates >= ${maxStepEvents}`
            : turnBytes + charge > maxTurnBytes
              ? `turn bytes > ${maxTurnBytes}`
              : turnEvents >= maxTurnEvents
                ? `turn updates >= ${maxTurnEvents}`
                : undefined;
      if (breach) {
        stopped = true;
        log(
          `[output-budget] stopped turn: ${breach} step=${key} ` +
            `stepBytes=${step.bytes} stepUpdates=${step.events} ` +
            `turnBytes=${turnBytes} turnUpdates=${turnEvents} rejectedBytes=${size}\n`,
        );
        onExceeded?.(
          `Agent output exceeded the turn limit (${stepBreach ? maxStepBytes : maxTurnBytes} bytes or ` +
            `${stepBreach ? maxStepEvents : maxTurnEvents} updates). ` +
            "The turn was stopped to protect the runner. Check the model or provider before retrying.",
        );
        return false;
      }
      step.bytes += charge;
      step.events += 1;
      if (progress) step.snapshot = Math.max(step.snapshot, size);
      steps.set(key, step);
      turnBytes += charge;
      turnEvents += 1;
      return true;
    },
  };
}

/** Mirrors `hasToolArgs` in otel.ts: `{}` and absent input carry no arguments. */
function hasToolArgs(input: unknown): boolean {
  if (input == null) return false;
  return !(
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).length === 0
  );
}
