/**
 * Credential-substitution preflight for fresh Daytona sandboxes.
 *
 * THE FAULT THIS DETECTS (measured 2026-08-30, docs/design/daytona-secret-propagation/).
 * On a Daytona run the model key never enters the sandbox: it is a Daytona Secret, and the
 * sandbox holds a `dtn_secret_<id>` placeholder Daytona substitutes into egress requests to
 * the key's exact host. That wiring is BINARY PER SANDBOX: a healthy sandbox substitutes on
 * its very first request (~2s after Secret creation), and a stuck sandbox never does — the
 * raw placeholder reaches the provider for as long as anyone watches, a twin sandbox on the
 * SAME Secret works immediately, and stop+start does not repair it. Measured 5 stuck of 20
 * fresh sandboxes (target eu); production showed ~3% over an earlier window, so the rate
 * varies. Waiting therefore cannot help; only a fresh sandbox can.
 *
 * THE MECHANISM. Right after the sandbox is created, probe the credential's own endpoint
 * from INSIDE the sandbox: POST `${baseUrl}/chat/completions` with the key env var as the
 * bearer. A response echoing `dtn_` means the placeholder went through raw (LiteLLM and
 * OpenAI-compatible providers echo the bad key; Daytona's response scrubbing rewrites REAL
 * values back to placeholders but leaves the raw-placeholder echo visible). Several
 * consecutive raw echoes convict the sandbox as STUCK; any other response means the header
 * was substituted (a 400 for the junk body, a real 401 for a genuinely bad key) and the run
 * may proceed. The preflight runs CONCURRENTLY with the rest of acquire (mounts, workspace,
 * session open, ~10s), so a healthy sandbox pays nothing.
 *
 * WHAT A "STUCK" VERDICT DOES. The acquire path destroys the environment and retries ONCE
 * with a brand-new sandbox, because the twin experiment proved a new sandbox on the same
 * Secret works. The user sees a slower first turn instead of a failed one.
 *
 * THE 30-SECOND GRACE IS DAYTONA'S OWN NUMBER (2026-08-31, their support, confirming our
 * report): "If a retry on the same sandbox starts working within ~30s, you can keep it. If
 * the placeholder is still going out after that, recreate. Retrying or restarting the same
 * one will not help." So the preflight keeps probing to that bound before convicting — our
 * own 20 samples saw nothing land between 3s and 180s, but their bound is authoritative for
 * their system, and the grace runs concurrently with acquire setup so a healthy sandbox
 * still pays nothing.
 *
 * SCOPE. Only a freshly created Daytona sandbox whose MODEL credential rides a Daytona
 * Secret and whose connection declares an endpoint base URL (the custom OpenAI-compatible
 * shape — every observed incident). A plaintext-env run has no placeholder; a reconnected
 * sandbox already proved itself.
 *
 * AMBIGUITY FAILS OPEN. A probe that errors or returns nothing judgeable returns "ok" and
 * the run proceeds: the worst outcome is the pre-existing behavior, classified honestly by
 * `classifyRunError`. Only consecutive, unambiguous raw-placeholder echoes convict.
 */

export interface PreflightSandbox {
  runProcess(request: {
    command: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<{ exitCode?: number | null; stdout: string } | undefined>;
}

/** The preflight's answer: proceed, or this sandbox will never substitute. */
export type CredentialPreflightVerdict = "ok" | "stuck";

/** Thrown by the acquire path when the preflight convicts the sandbox. */
export class SubstitutionStuckError extends Error {
  constructor() {
    super(
      "This sandbox never received its credential-substitution wiring (raw placeholder " +
        "echoed on every probe); a fresh sandbox is required.",
    );
    this.name = "SubstitutionStuckError";
  }
}

/** Total acquire attempts when a sandbox is convicted stuck: the original plus one retry. */
export const STUCK_ACQUIRE_ATTEMPTS = 2;

export interface CredentialPreflightInput {
  sandbox: PreflightSandbox;
  /** The custom connection's endpoint base URL (`modelConnection.endpoint.baseUrl`). */
  baseUrl: string;
  /** The env var name holding the key in the sandbox (the Secret's placeholder). */
  apiKeyVar: string;
  log: (message: string) => void;
  /** Total budget from first probe to giving up (fail open). */
  budgetMs?: number;
  /** Delay between probes. */
  pollMs?: number;
  /** Injectable clock/sleep for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Daytona's stated keep-or-recreate bound: wiring that has not landed by ~30s never lands. */
const DEFAULT_BUDGET_MS = 30_000;
const DEFAULT_POLL_MS = 2_500;
const CURL_TIMEOUT_S = 8;

/**
 * Resolve "ok" when the sandbox's model credential substitutes on the wire (or nothing can be
 * judged — fail open), and "stuck" after enough consecutive raw-placeholder echoes. Never
 * throws.
 */
export async function awaitCredentialSubstitution(
  input: CredentialPreflightInput,
): Promise<CredentialPreflightVerdict> {
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS;
  const pollMs = input.pollMs ?? DEFAULT_POLL_MS;
  const url = `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // The env var is expanded by the sandbox shell, so the placeholder value never appears in
  // any runner-side string. `-d "{}"` makes an auth-first endpoint answer without a model call.
  const script =
    `curl -s -m ${CURL_TIMEOUT_S} -X POST ` +
    `-H "Content-Type: application/json" ` +
    `-H "Authorization: Bearer $${input.apiKeyVar}" ` +
    `-d "{}" ${JSON.stringify(url)}`;

  const startedAt = now();
  for (let attempt = 1; ; attempt++) {
    let body: string | undefined;
    try {
      const result = await input.sandbox.runProcess({
        command: "sh",
        args: ["-c", script],
        timeoutMs: (CURL_TIMEOUT_S + 4) * 1000,
      });
      body = result?.stdout;
    } catch (error) {
      // The exec channel itself failed (sandbox tearing down, daemon hiccup): fail open.
      input.log(
        `[credential-preflight] probe errored, proceeding: ${String(
          error instanceof Error ? error.message : error,
        ).slice(0, 120)}`,
      );
      return "ok";
    }
    const elapsedMs = now() - startedAt;
    if (!body || !body.includes("dtn_")) {
      // Substituted (or the endpoint gave no echo to judge by — fail open either way).
      if (attempt > 1) {
        input.log(
          `[credential-preflight] substitution confirmed after ${attempt} probes ` +
            `(${(elapsedMs / 1000).toFixed(1)}s)`,
        );
      }
      return "ok";
    }
    if (elapsedMs + pollMs > budgetMs) {
      input.log(
        `[credential-preflight] STUCK: raw placeholder on all ${attempt} probes ` +
          `(${(elapsedMs / 1000).toFixed(1)}s); this sandbox will never substitute`,
      );
      return "stuck";
    }
    input.log(
      `[credential-preflight] raw placeholder echoed (probe ${attempt}, ` +
        `+${(elapsedMs / 1000).toFixed(1)}s)`,
    );
    await sleep(pollMs);
  }
}
