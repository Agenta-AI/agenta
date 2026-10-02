import { envInt } from "../env.ts";

/** Bound admitted output before tracing, persistence and live delivery make copies of it.
 * Counts wire bytes, including repeated snapshots, rather than claiming to measure heap use.
 * The transport has already decoded a single frame here; this is not a frame-size firewall.
 */
export function createOutputBudget(onExceeded?: (reason: string) => void): {
  accept(value: unknown): boolean;
} {
  const maxBytes = envInt("AGENTA_RUNNER_OUTPUT_MAX_BYTES", 16 * 1024 * 1024, {
    min: 1024,
    max: 256 * 1024 * 1024,
  });
  const maxEvents = envInt("AGENTA_RUNNER_OUTPUT_MAX_EVENTS", 50_000, {
    min: 1,
    max: 1_000_000,
  });
  let bytes = 0;
  let events = 0;
  let stopped = false;
  return {
    accept(value) {
      if (stopped) return false;
      const size = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
      if (size > maxBytes - bytes || events >= maxEvents) {
        stopped = true;
        onExceeded?.(
          `Agent output exceeded the turn limit (${maxBytes} bytes or ${maxEvents} updates). ` +
            "The turn was stopped to protect the runner. Check the model or provider before retrying.",
        );
        return false;
      }
      bytes += size;
      events += 1;
      return true;
    },
  };
}
