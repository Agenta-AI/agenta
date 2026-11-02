import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it.each(["agent_message_chunk", "agent_thought_chunk"])(
  "bounds retained %s output in a 256 MiB heap and still serves another turn",
  async (kind) => {
    const { stdout } = await exec(
      process.execPath,
      [
        "--max-old-space-size=256",
        "--expose-gc",
        "--import",
        "tsx",
        fileURLToPath(
          new URL("../fixtures/output-retention.mjs", import.meta.url),
        ),
        kind,
      ],
      {
        timeout: 30_000,
        env: {
          ...process.env,
          AGENTA_RUNNER_OUTPUT_MAX_BYTES: "4194304",
          AGENTA_RUNNER_OUTPUT_MAX_EVENTS: "50000",
        },
      },
    );
    const result = JSON.parse(stdout);
    expect(result.breaches).toBe(1);
    expect(result.healthySecondTurn).toBe(true);
    expect(result.delivered).toBeLessThan(result.updatesOffered);
  },
  35_000,
);
