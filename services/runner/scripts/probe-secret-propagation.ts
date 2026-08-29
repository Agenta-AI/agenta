/**
 * Measure Daytona Secret substitution propagation, from the runner's own SDK calls.
 *
 * THE QUESTION. The runner never puts a model key inside a sandbox: it creates a Daytona
 * Secret restricted to one host and the sandbox holds a `dtn_secret_<id>` placeholder that
 * Daytona substitutes into egress requests to that host. That substitution propagates
 * asynchronously with no confirmation signal. On EU cloud prod (2026-08-29) about 3% of a
 * fresh sandbox's FIRST outbound calls carried the raw placeholder (a 401 at the model
 * proxy), 10-24s after the Secret was created; roughly half the failures had a delete of the
 * previous same-host Secret seconds earlier. This probe measures both hypotheses:
 *
 *  - H1 (create lag): how long after `secret.create` + sandbox create until the first
 *    substituted request?
 *  - H2 (delete interference, `--delete-old`): does deleting an older Secret for the SAME
 *    host right before the create (the eviction ordering: destroy sandbox, delete its
 *    Secrets, allocate new ones) widen that window?
 *
 * METHOD. The Secret's allowed host is httpbin.org, and the sandbox curls
 * https://httpbin.org/headers with `Authorization: Bearer $PROBE_KEY` in a loop. The
 * response echoes the header Daytona actually sent: the real value means substitution is
 * live, the `dtn_` placeholder means it is not yet. First-substitution time is the sample.
 *
 * RUN IT from an environment that already holds the runner's Daytona credentials (the dev
 * box, or the runner container), never with a personal key:
 *
 *   cd services/runner
 *   AGENTA_RUNNER_DAYTONA_API_KEY=... pnpm exec tsx scripts/probe-secret-propagation.ts \
 *     --runs 10 [--delete-old]
 *
 * Each run creates one sandbox and one or two Secrets and deletes them afterwards; a run
 * costs about a sandbox-minute. The tool is side-effect-clean on success; on a crash, the
 * `probe-secret-propagation` name prefix makes leftovers findable in the Daytona dashboard.
 */
import { randomBytes } from "node:crypto";

import { Daytona } from "@daytonaio/sdk";

const HOST = "httpbin.org";
const POLL_MS = 1000;
const MAX_WAIT_MS = 120_000;

const args = process.argv.slice(2);
const deleteOld = args.includes("--delete-old");
const runsFlag = args.indexOf("--runs");
const runs = runsFlag >= 0 ? Number(args[runsFlag + 1]) : 3;

const apiKey =
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY || process.env.DAYTONA_API_KEY;
if (!apiKey) {
  console.error(
    "Set AGENTA_RUNNER_DAYTONA_API_KEY (or DAYTONA_API_KEY) before running.",
  );
  process.exit(2);
}
process.env.DAYTONA_API_KEY = apiKey;
if (process.env.AGENTA_RUNNER_DAYTONA_API_URL) {
  process.env.DAYTONA_API_URL = process.env.AGENTA_RUNNER_DAYTONA_API_URL;
}

const client = new Daytona();

function name(tag: string): string {
  return `probe-secret-propagation-${tag}-${randomBytes(6).toString("hex")}`;
}

async function oneRun(index: number): Promise<number | undefined> {
  const realValue = `probe-real-${randomBytes(9).toString("hex")}`;
  let oldSecret: { id: string } | undefined;
  let secret: { id: string; name: string } | undefined;
  let sandbox: any;
  try {
    if (deleteOld) {
      // The eviction ordering: an older same-host Secret exists, and its delete lands
      // moments before the new create (destroy sandbox -> delete Secrets -> allocate).
      oldSecret = await client.secret.create({
        name: name("old"),
        value: `probe-old-${randomBytes(9).toString("hex")}`,
        hosts: [HOST],
      });
      await client.secret.delete(oldSecret.id);
      oldSecret = undefined;
    }

    secret = await client.secret.create({
      name: name("new"),
      value: realValue,
      hosts: [HOST],
    });
    const createdAt = Date.now();

    sandbox = await client.create({
      secrets: { PROBE_KEY: secret.name },
      ephemeral: true,
    });
    const sandboxReadyAt = Date.now();

    let substitutedAtMs: number | undefined;
    while (Date.now() - createdAt < MAX_WAIT_MS) {
      const result = await sandbox.process.executeCommand(
        `curl -s -m 10 -H "Authorization: Bearer $PROBE_KEY" https://${HOST}/headers`,
      );
      const body = String(result?.result ?? "");
      const sawReal = body.includes(realValue);
      const sawPlaceholder = body.includes("dtn_");
      const t = ((Date.now() - createdAt) / 1000).toFixed(1);
      if (sawReal) {
        substitutedAtMs = Date.now() - createdAt;
        console.log(
          `run=${index} t=+${t}s SUBSTITUTED (sandbox ready at +${((sandboxReadyAt - createdAt) / 1000).toFixed(1)}s)`,
        );
        break;
      }
      console.log(
        `run=${index} t=+${t}s ${sawPlaceholder ? "raw placeholder" : "no auth echo (curl failed?)"}`,
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (substitutedAtMs === undefined) {
      console.log(
        `run=${index} NEVER substituted within ${MAX_WAIT_MS / 1000}s`,
      );
    }
    return substitutedAtMs;
  } finally {
    try {
      if (sandbox) await client.delete(sandbox);
    } catch {
      /* leftover is findable by name prefix */
    }
    try {
      if (secret) await client.secret.delete(secret.id);
    } catch {
      /* ditto */
    }
    try {
      if (oldSecret) await client.secret.delete(oldSecret.id);
    } catch {
      /* ditto */
    }
  }
}

const samples: number[] = [];
for (let i = 1; i <= runs; i++) {
  const ms = await oneRun(i);
  if (ms !== undefined) samples.push(ms);
}
samples.sort((a, b) => a - b);
console.log(
  `\nmode=${deleteOld ? "delete-old-then-create" : "plain-create"} runs=${runs} ` +
    `substituted=${samples.length} ` +
    (samples.length
      ? `min=${(samples[0] / 1000).toFixed(1)}s ` +
        `median=${(samples[Math.floor(samples.length / 2)] / 1000).toFixed(1)}s ` +
        `max=${(samples[samples.length - 1] / 1000).toFixed(1)}s`
      : ""),
);
