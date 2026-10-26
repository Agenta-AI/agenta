import { envInt } from "../env.ts";

const MODEL_STEP = "model";

type Step = { bytes: number; events: number; snapshot: number };

/** Bound admitted output before tracing, persistence and live delivery make copies of it.
 * The limit applies to each step (one model reply or one tool call), with a looser backstop for
 * the whole turn, so a long turn of normal steps finishes while one runaway step is still stopped.
 * A running tool resends its whole output so far on every progress update and only the last copy
 * is kept, so a tool update is charged only for the bytes it adds over its largest earlier copy.
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
      const step = steps.get(key) ?? { bytes: 0, events: 0, snapshot: 0 };
      const charge =
        acpToolId != null ? Math.max(0, size - step.snapshot) : size;

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
          `Agent output exceeded the turn limit (${maxStepBytes} bytes or ${maxStepEvents} updates). ` +
            "The turn was stopped to protect the runner. Check the model or provider before retrying.",
        );
        return false;
      }
      step.bytes += charge;
      step.events += 1;
      if (acpToolId != null) step.snapshot = Math.max(step.snapshot, size);
      steps.set(key, step);
      turnBytes += charge;
      turnEvents += 1;
      return true;
    },
  };
}
