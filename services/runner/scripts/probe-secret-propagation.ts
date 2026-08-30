/**
 * Measure the Daytona Secret substitution STUCK-SANDBOX rate, with the runner's own SDK calls.
 *
 * THE FAULT THIS MEASURES (established 2026-08-30, see
 * docs/design/daytona-secret-propagation/README.md). Substitution is binary per sandbox: a
 * healthy sandbox substitutes on its very FIRST outbound request (+1.5-2.9s after Secret
 * creation), and a stuck sandbox NEVER substitutes — the raw `dtn_secret_<id>` placeholder
 * reaches the provider for as long as you watch, a twin sandbox on the same Secret works, and
 * stop+start does not repair it. Measured 5 stuck of 20 on 2026-08-30 (target eu).
 *
 * THE INSTRUMENT, AND WHY AN ECHO SERVICE CANNOT WORK. Daytona's egress proxy also scrubs
 * responses: real values are rewritten back to placeholders before the response enters the
 * sandbox, so httpbin-style echoes read `dtn_...` whether substitution happened or not (a
 * literal real value typed into the header comes back as the placeholder). The working
 * instrument is a provider whose error body echoes a MASKED key that scrubbing does not
 * rewrite: api.openai.com answers a bad key with "Incorrect API key provided: sk-probe****".
 * `sk-prob` in the body = substituted; `dtn_` in the body = the raw placeholder went out.
 *
 * RUN IT from an environment that already holds the runner's Daytona credentials (the dev
 * box, or the runner container), never with a personal key:
 *
 *   cd services/runner
 *   AGENTA_RUNNER_DAYTONA_API_KEY=... pnpm exec tsx scripts/probe-secret-propagation.ts \
 *     --runs 10 [--delete-old]
 *
 * `--delete-old` reproduces the eviction ordering (delete the previous same-host Secret just
 * before the create); the 2026-08-30 runs showed it does NOT change the stuck rate. Each run
 * creates one sandbox and one or two Secrets and deletes them afterwards; leftovers carry the
 * `probe-secret-propagation` name prefix.
 */
import { randomBytes } from "node:crypto";

import { Daytona } from "@daytonaio/sdk";

const HOST = "api.openai.com";
const POLL_MS = 1500;
const MAX_WAIT_MS = 90_000;

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

/** One sample: milliseconds to first substituted request, or undefined = stuck. */
async function oneRun(index: number): Promise<number | undefined> {
  // The value must look like an OpenAI key so the 401 body echoes its masked form.
  const realValue = `sk-probe${randomBytes(9).toString("hex")}`;
  let oldSecret: { id: string } | undefined;
  let secret: { id: string; name: string } | undefined;
  let sandbox: any;
  try {
    if (deleteOld) {
      oldSecret = await client.secret.create({
        name: name("old"),
        value: `sk-probeold${randomBytes(9).toString("hex")}`,
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

    while (Date.now() - createdAt < MAX_WAIT_MS) {
      const result = await sandbox.process.executeCommand(
        `curl -s -m 10 -H "Authorization: Bearer $PROBE_KEY" https://${HOST}/v1/models`,
      );
      const body = String(result?.result ?? "");
      const t = ((Date.now() - createdAt) / 1000).toFixed(1);
      if (body.includes("sk-prob")) {
        console.log(`run=${index} t=+${t}s SUBSTITUTED`);
        return Date.now() - createdAt;
      }
      console.log(
        `run=${index} t=+${t}s ${
          body.includes("dtn_")
            ? "RAW PLACEHOLDER reached the provider"
            : `no key echo: ${body.slice(0, 60)}`
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    console.log(
      `run=${index} STUCK: never substituted within ${MAX_WAIT_MS / 1000}s`,
    );
    return undefined;
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
let stuck = 0;
for (let i = 1; i <= runs; i++) {
  const ms = await oneRun(i);
  if (ms === undefined) stuck++;
  else samples.push(ms);
}
samples.sort((a, b) => a - b);
console.log(
  `\nmode=${deleteOld ? "delete-old-then-create" : "plain-create"} runs=${runs} ` +
    `substituted=${samples.length} stuck=${stuck}` +
    (samples.length
      ? ` firstOkSeconds=[${samples.map((v) => (v / 1000).toFixed(1)).join(",")}]`
      : ""),
);
