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
 * bearer. Several consecutive raw-placeholder echoes convict the sandbox as STUCK; any other
 * response means the header was substituted (a 400 for the junk body, a real 401 for a
 * genuinely bad key) and the run may proceed. The preflight runs CONCURRENTLY with the rest
 * of acquire (mounts, workspace, session open, ~10s), so a healthy sandbox pays nothing.
 *
 * ONLY A MASKED ECHO CONVICTS, AND THAT DISTINCTION IS THE WHOLE INSTRUMENT. A bare `dtn_`
 * in the body proves nothing: Daytona's egress proxy also SCRUBS responses, rewriting real
 * credential values back into `dtn_secret_<id>` before they reach the sandbox. So an endpoint
 * that echoes the Authorization header verbatim returns the full placeholder shape on a
 * perfectly HEALTHY sandbox, and convicting on that would destroy both acquire attempts and
 * fail a first turn whose real model call would have worked. What scrubbing cannot forge is a
 * MASKED placeholder: a provider masks the key it received (LiteLLM's
 * "Virtual Key expected. Received=dtn_****", OpenAI's "Incorrect API key provided:
 * dtn_secr*****"), and a masked string no longer contains the real value for the scrubber to
 * match — so a masked `dtn_` can only mean the raw placeholder really went out. This is the
 * same correction that invalidated the first probe run; see the "CORRECTED" section of
 * `docs/design/daytona-secret-propagation/README.md`. Every incident observed in production
 * and in the 20-sandbox probe carried a masked echo, so the narrower signature costs no
 * detection.
 *
 * WHAT A "STUCK" VERDICT DOES. The acquire path destroys the environment and retries ONCE
 * with a brand-new sandbox, because the twin experiment proved a new sandbox on the same
 * Secret works. The user sees a slower first turn instead of a failed one.
 *
 * THE GRACE IS 10 SECONDS, A DELIBERATE CHOICE BELOW DAYTONA'S ~30s BOUND. Their support
 * (2026-08-31, confirming our report) said a sandbox may still start working within ~30s
 * and must be recreated after that; "retrying or restarting the same one will not help."
 * Our own 20 samples saw nothing land between 3s and 180s, every healthy sandbox answered
 * on its FIRST probe, and their wiring fix is in progress on their side — so we convict at
 * 10s and rebuild rather than hold every stuck user turn another 20s for a recovery nobody
 * has observed. Decided by the product owner 2026-08-31; revisit only if a late recovery
 * ever shows up in the preflight logs (it would log "substitution confirmed after N
 * probes" with N > 1).
 *
 * SCOPE. Only a freshly created Daytona sandbox whose MODEL credential rides a Daytona
 * Secret and whose connection declares an endpoint base URL (the custom OpenAI-compatible
 * shape — every observed incident). A plaintext-env run has no placeholder; a reconnected
 * sandbox already proved itself.
 *
 * AMBIGUITY FAILS OPEN. A probe that errors, returns nothing judgeable, or returns an
 * UNMASKED placeholder-shaped echo returns "ok" and the run proceeds: the worst outcome is
 * the pre-existing behavior, classified honestly by `classifyRunError`. Only consecutive,
 * unambiguous masked raw-placeholder echoes convict.
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

/** See the module doc: 10s, deliberately below Daytona's ~30s keep-or-recreate bound. */
const DEFAULT_BUDGET_MS = 10_000;
const DEFAULT_POLL_MS = 2_000;
const CURL_TIMEOUT_S = 8;

/**
 * The only echo that proves the raw placeholder went out: one the provider MASKED.
 *
 * See the module doc. Daytona's response scrubbing rewrites a real credential back into
 * `dtn_secret_<id>`, so an unmasked placeholder shape is equally consistent with a HEALTHY
 * sandbox whose endpoint echoed the working key. Masking defeats the scrubber, because the
 * masked string no longer contains the real value to match.
 *
 * First alternative: a `dtn_` token carrying a mask character, which covers both proven
 * shapes (LiteLLM's `Received=dtn_****`, OpenAI's `dtn_secr*****`). Second: LiteLLM naming a
 * `dtn_` key as what it received, which is proof on its own and survives a change of mask
 * character; it mirrors `PLACEHOLDER_CREDENTIAL` in `errors.ts`. `*` is the only mask
 * character trusted here — a truncation with `...` or `…` could equally be a cut-off scrubbed
 * value, and ambiguity fails open.
 */
const MASKED_PLACEHOLDER_ECHO =
  /dtn_[A-Za-z0-9_-]*\*|virtual key expected.*received=\s*dtn_/i;

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
    if (!body || !MASKED_PLACEHOLDER_ECHO.test(body)) {
      // Substituted, or the endpoint gave nothing this preflight can judge by — fail open
      // either way. An unmasked placeholder shape lands here on purpose: scrubbing produces
      // it from a healthy key too, so it is not evidence. Log it, because a stuck sandbox
      // behind an echoing endpoint now passes the preflight and surfaces as the 401 instead.
      if (body?.includes("dtn_")) {
        input.log(
          `[credential-preflight] unmasked placeholder-shaped echo (probe ${attempt}, ` +
            `+${(elapsedMs / 1000).toFixed(1)}s): scrubbing produces this from a REAL key ` +
            `too, so it convicts nothing; proceeding`,
        );
      } else if (attempt > 1) {
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
