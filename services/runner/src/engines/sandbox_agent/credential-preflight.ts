/**
 * Credential-substitution preflight for fresh Daytona sandboxes.
 *
 * THE RACE THIS CLOSES. On a Daytona run the model key never enters the sandbox: it is a
 * Daytona Secret, and the sandbox holds a `dtn_secret_<id>` placeholder that Daytona
 * substitutes into egress requests to the key's exact host. That substitution propagates
 * asynchronously with NO confirmation signal, and on EU cloud production (2026-08-29) about
 * 3% of fresh sandboxes' first model calls carried the raw placeholder — a 401 at the model
 * proxy and a failed first turn (classified `credential_delivery_failed`). Every observed
 * failure was a FIRST call, 10-24s after Secret creation; substitution never broke
 * mid-session, so once one probe substitutes, the sandbox is good.
 *
 * THE MECHANISM. Right after the sandbox is created, probe the credential's own endpoint
 * from INSIDE the sandbox: POST `${baseUrl}/chat/completions` with the key env var as the
 * bearer. When the response echoes `dtn_`, the placeholder went through raw (both LiteLLM —
 * "Virtual Key expected. Received=dtn_…" — and OpenAI-compatible providers echo the bad
 * key), so wait and probe again. Any other response means the header was substituted (a 400
 * for the junk body, a real 401 for a genuinely bad key) and the run may proceed. The
 * preflight runs CONCURRENTLY with the rest of acquire (mounts, workspace, session open,
 * ~10s), so the common case pays nothing; only a still-racing sandbox waits at the end.
 *
 * SCOPE. Only a freshly created Daytona sandbox whose MODEL credential rides a Daytona
 * Secret and whose connection declares an endpoint base URL (the custom OpenAI-compatible
 * shape — every observed incident). A plaintext-env run has no placeholder; a reconnected
 * sandbox already proved itself.
 *
 * FAIL OPEN, ALWAYS. A probe that errors, times out, or exhausts the budget logs and lets
 * the run proceed: the worst outcome is the pre-existing behavior, now at least classified
 * honestly by `classifyRunError`. This unit must never fail a turn that would have worked.
 */

export interface PreflightSandbox {
  runProcess(request: {
    command: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<{ exitCode?: number | null; stdout: string } | undefined>;
}

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

const DEFAULT_BUDGET_MS = 25_000;
const DEFAULT_POLL_MS = 2_000;
const CURL_TIMEOUT_S = 8;

/**
 * Resolve when the sandbox's model credential substitutes on the wire, or when the budget is
 * spent (fail open). Never throws.
 */
export async function awaitCredentialSubstitution(
  input: CredentialPreflightInput,
): Promise<void> {
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
      return;
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
      return;
    }
    if (elapsedMs + pollMs > budgetMs) {
      input.log(
        `[credential-preflight] placeholder still raw after ${attempt} probes ` +
          `(${(elapsedMs / 1000).toFixed(1)}s); proceeding fail-open`,
      );
      return;
    }
    input.log(
      `[credential-preflight] raw placeholder echoed (probe ${attempt}, ` +
        `+${(elapsedMs / 1000).toFixed(1)}s); waiting for Daytona substitution`,
    );
    await sleep(pollMs);
  }
}
