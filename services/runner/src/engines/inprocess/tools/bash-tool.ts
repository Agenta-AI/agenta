/**
 * The `bash` tool of an in-process session: Pi's tool definition (name, schema, prompt text,
 * rendering) with an execution of our own that runs the command in the conversation's command
 * sandbox. The model sees what Pi's shell tool shows it, with the same truncation, the same
 * status lines and the same errors; the full output of a long command stays in the sandbox at a
 * path this tool chose, where the model's next command can read it.
 */
import { createBashToolDefinition, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type BashToolDetails, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CommandRequest, CommandResult } from "../conversation-workspace.ts";
import { CommandOutput } from "./command-output.ts";
import { TIMER_MAX_MS } from "../../../env.ts";

/** Pi's own limit on a timeout, in seconds (a 32-bit millisecond timer). */
const MAX_TIMEOUT_SECONDS = TIMER_MAX_MS / 1000;
/** Pi's pace for streaming partial output to the client. */
const UPDATE_THROTTLE_MS = 100;

export type RunCommand = (request: Omit<CommandRequest, "requirements" | "preparations">) => Promise<CommandResult>;

/** Where the sandbox keeps a tool call's full output. */
export const outputPathFor = (toolCallId: string) => `/tmp/agenta-output-${toolCallId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)}.log`;

function timeoutSeconds(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid timeout: must be a finite number of seconds");
  if (timeout > MAX_TIMEOUT_SECONDS) throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
  return timeout;
}

const withStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

export function createSandboxBashTool(
  cwd: string,
  run: RunCommand,
  /** Counts the command's output buffer against its session while it runs; returns the release. */
  track: (output: CommandOutput) => () => void = () => () => {},
): ToolDefinition<any, any> {
  const definition = createBashToolDefinition(cwd, { exposeSessionEnvironment: false });
  const tool: typeof definition = {
    ...definition,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const seconds = timeoutSeconds(params.timeout);
      const output = new CommandOutput();
      const untrack = track(output);
      const outputPath = outputPathFor(toolCallId);
      let timer: NodeJS.Timeout | undefined;
      let lastUpdate = 0;
      const sendUpdate = () => {
        timer = undefined;
        lastUpdate = Date.now();
        const { text, truncation } = output.snapshot();
        onUpdate?.({ content: [{ type: "text", text }], details: truncation ? { truncation } : undefined });
      };
      const scheduleUpdate = () => {
        if (!onUpdate || timer) return;
        timer = setTimeout(sendUpdate, Math.max(0, UPDATE_THROTTLE_MS - (Date.now() - lastUpdate)));
      };
      onUpdate?.({ content: [], details: undefined });
      try {
        const result = await run({
          command: params.command,
          cwd: ctx?.cwd || cwd,
          ...(seconds ? { timeoutSeconds: seconds } : {}),
          ...(signal ? { signal } : {}),
          outputPath,
          // Half of Pi's limits: the notices appended after the command can never push output
          // this small past the limits, so the model always sees all of it and the file can go.
          discardOutputUpTo: { bytes: DEFAULT_MAX_BYTES / 2, lines: DEFAULT_MAX_LINES / 2 },
          output: {
            append: (chunk) => {
              output.append(chunk);
              scheduleUpdate();
            },
            skip: (bytes) => output.skip(bytes),
            settle: (totals) => output.settle(totals),
          },
        });
        const { outcome } = result;
        // The file outlives the command unless its sandbox was retired.
        const shownPath = outcome.kind === "unknown" ? undefined : outputPath;
        if (outcome.kind === "unknown") {
          throw new Error(withStatus(output.format(undefined, "").text, `Command outcome unknown: ${outcome.reason}. Check what it did before running it again.`));
        }
        if (outcome.kind === "aborted") throw new Error(withStatus(output.format(shownPath, "").text, "Command aborted"));
        if (outcome.kind === "timed_out") {
          throw new Error(withStatus(output.format(shownPath, "").text, `Command timed out after ${outcome.seconds} seconds`));
        }
        const { text, truncation } = output.format(shownPath);
        if (outcome.exitCode !== 0) throw new Error(withStatus(text, `Command exited with code ${outcome.exitCode}`));
        const details: BashToolDetails | undefined = truncation ? { truncation, ...(shownPath ? { fullOutputPath: shownPath } : {}) } : undefined;
        return { content: [{ type: "text", text }], details };
      } finally {
        if (timer) clearTimeout(timer);
        untrack();
      }
    },
  };
  return tool;
}
