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
 * THE MECHANISM. Right after the sandbox is created, probe the credential's own endpoint from
 * INSIDE the sandbox: POST the provider's auth-first path with the key env var as the
 * credential. Several consecutive placeholder answers convict the sandbox as STUCK; any other
 * response means the header was substituted (a 400 for the junk body, a real 401 for a
 * genuinely bad key) and the run may proceed. The preflight runs CONCURRENTLY with the rest of
 * acquire (mounts, workspace, session open, ~10s), so a healthy sandbox pays nothing.
 *
 * TWO INSTRUMENTS READ THAT PROBE, BECAUSE ONE OF THEM IS BLIND ON HALF THE PROVIDERS.
 *
 * 1. THE MASKED ECHO, for a provider that quotes back what it received. A bare `dtn_` in the
 * body proves nothing: Daytona's egress proxy also SCRUBS responses, rewriting real credential
 * values back into `dtn_secret_<id>` before they reach the sandbox. So an endpoint that echoes
 * the Authorization header verbatim returns the full placeholder shape on a perfectly HEALTHY
 * sandbox, and convicting on that would destroy both acquire attempts and fail a first turn
 * whose real model call would have worked. What scrubbing cannot forge is a MASKED placeholder:
 * a provider masks the key it received (LiteLLM's "Virtual Key expected. Received=dtn_****",
 * OpenAI's "Incorrect API key provided: dtn_secr*****"), and a masked string no longer contains
 * the real value for the scrubber to match — so a masked `dtn_` can only mean the raw
 * placeholder really went out. This is the same correction that invalidated the first probe
 * run; see the "CORRECTED" section of `docs/design/daytona-secret-propagation/README.md`.
 *
 * 2. THE CONTROL CALL, for a provider that echoes nothing. OpenRouter answers a bad bearer with
 * a plain 401 that never names the key, and so do Anthropic and Gemini. Instrument 1 sees
 * nothing there and fails open, so every stuck sandbox on those connections became a failed
 * first turn: 10 user-visible failures on the direct OpenRouter connection in production over
 * 2026-09-01..02 (AGE-4249). The runner itself holds the real key at this point, because it
 * created the Secret from it. So it makes ONE call of its own, from the runner process, to the
 * same URL with the same body, concurrently with the sandbox probe. The two answers together
 * are the reading: sandbox 401 plus control accepted means the sandbox sent something the
 * provider refused while the real key works, and the only other thing the sandbox can send is
 * the raw placeholder. Control refused (401 or 403) means the key itself is bad, which is not
 * this fault. The control call is body-independent, so no provider wording can hide the fault
 * from it.
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
 * SCOPE. Only a freshly created Daytona sandbox whose MODEL credential rides a Daytona Secret
 * and whose connection declares an endpoint base URL. That covers the OpenAI-compatible shape
 * (the LiteLLM credits proxy, OpenAI, OpenRouter and any custom gateway) and the Anthropic
 * shape, which are the two request shapes below. A provider outside those two stays on the
 * OpenAI-compatible shape and therefore fails open on anything it cannot judge, exactly as an
 * unknown response body does. Gemini is not covered: its auth rides a query parameter rather
 * than a header, so it needs its own shape and its own evidence. A plaintext-env run has no
 * placeholder; a reconnected sandbox already proved itself.
 *
 * THE KEY VALUE NEVER LEAVES THIS MODULE. The sandbox command carries the env var name, which
 * the sandbox shell expands, and the control call carries the value in a request header only.
 * Every log line goes through a redactor, so no future message can leak it either.
 *
 * AMBIGUITY FAILS OPEN. Any of these returns "ok" and the run proceeds: a probe that errors, a
 * body with nothing judgeable in it, an UNMASKED placeholder-shaped echo, a sandbox status that
 * is not 401, a control call that was refused, and a control call that errored, timed out, or
 * gave no status. The worst outcome is the pre-existing behavior, classified honestly by
 * `classifyRunError`. Only consecutive, unambiguous readings convict: a masked raw-placeholder
 * echo, or a sandbox 401 beside a control call that accepted the same key.
 */

/**
 * Does this acquire deliver the run's MODEL credential as a Daytona Secret?
 *
 * The condition the preflight gates on, minus the endpoint — and the condition that arms the
 * classifier's credential-race reading. Those two must not drift: the preflight can only SEE the
 * race on a provider whose shape it knows, but the race EXISTS wherever a model key rides a
 * Secret on a fresh sandbox. Naming it once keeps that difference deliberate instead of
 * accidental.
 *
 * A reconnect is excluded because the sandbox already proved itself, a local run because there is
 * no Secret, and a plaintext-env run because there is no placeholder to substitute.
 *
 * Pure and unit-testable; `acquireEnvironment` itself cannot be driven without a live provider.
 */
export function deliversModelSecretOnCreate(input: {
  isDaytona: boolean;
  sandboxMode: string;
  hasModelSecretCandidate: boolean;
}): boolean {
  return (
    input.isDaytona &&
    input.sandboxMode === "create" &&
    input.hasModelSecretCandidate
  );
}

export interface PreflightSandbox {
  runProcess(request: {
    command: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<{ exitCode?: number | null; stdout: string } | undefined>;
}

/** One control call the runner makes itself, with the real key. */
export interface ControlProbeRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

/** What the control call answered. `status` is absent when nothing could be read. */
export interface ControlProbeResponse {
  status?: number;
}

export type ControlProbe = (
  request: ControlProbeRequest,
) => Promise<ControlProbeResponse>;

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
  /** The connection's provider family, which selects the request shape. */
  provider?: string;
  /**
   * The real key value, used ONLY as the control call's credential header.
   *
   * Without it the control instrument is unavailable and a bare 401 fails open, which is the
   * behavior that shipped before the control call existed.
   */
  controlKey?: string;
  log: (message: string) => void;
  /** Total budget from first probe to giving up (fail open). */
  budgetMs?: number;
  /** Delay between probes. */
  pollMs?: number;
  /** Injectable clock/sleep/control call for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  controlProbe?: ControlProbe;
}

/** See the module doc: 10s, deliberately below Daytona's ~30s keep-or-recreate bound. */
const DEFAULT_BUDGET_MS = 10_000;
const DEFAULT_POLL_MS = 2_000;
const CURL_TIMEOUT_S = 8;
const CONTROL_TIMEOUT_MS = 8_000;
/** Pinned by Anthropic's API, which refuses a `/v1/messages` call without it. */
const ANTHROPIC_VERSION = "2023-06-01";
/** Where the credential goes in a header template, for the sandbox and the control call alike. */
const KEY_SLOT = "%KEY%";

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
 * The auth-first request this preflight sends, in the shape the provider understands.
 *
 * Both shapes post an empty JSON body on purpose: an auth-first endpoint answers it without
 * running a model, so the probe costs nothing and returns quickly. The credential sits in
 * `KEY_SLOT` so the same shape builds the sandbox command (which gets a shell expansion) and
 * the control request (which gets the real value).
 */
interface ProbeShape {
  url: string;
  headers: [string, string][];
  body: string;
}

function probeShapeFor(baseUrl: string, provider?: string): ProbeShape {
  const base = baseUrl.replace(/\/+$/, "");
  if (provider?.trim().toLowerCase() === "anthropic") {
    return {
      url: `${base}/v1/messages`,
      headers: [
        ["Content-Type", "application/json"],
        ["x-api-key", KEY_SLOT],
        ["anthropic-version", ANTHROPIC_VERSION],
      ],
      body: "{}",
    };
  }
  // The OpenAI-compatible shape, and the fallback for a provider whose shape is unknown. It
  // covers the LiteLLM credits proxy, OpenAI, OpenRouter, and any custom gateway. An unknown
  // provider that does not speak it simply answers something unjudgeable, which fails open.
  return {
    url: `${base}/chat/completions`,
    headers: [
      ["Content-Type", "application/json"],
      ["Authorization", `Bearer ${KEY_SLOT}`],
    ],
    body: "{}",
  };
}

/**
 * The curl the sandbox runs. `-w` appends the HTTP status on its own line, which is the second
 * instrument's whole input: the body alone cannot tell a refusal from a substituted call on a
 * provider that echoes nothing. The env var is expanded by the sandbox shell, so the key value
 * never appears in any runner-side string.
 */
function sandboxProbeScript(shape: ProbeShape, apiKeyVar: string): string {
  const headers = shape.headers
    .map(
      ([name, value]) =>
        `-H "${name}: ${value.split(KEY_SLOT).join(`$${apiKeyVar}`)}" `,
    )
    .join("");
  return (
    `curl -s -m ${CURL_TIMEOUT_S} -w '\\n%{http_code}' -X POST ` +
    headers +
    `-d ${JSON.stringify(shape.body)} ${JSON.stringify(shape.url)}`
  );
}

/** Split curl's output into the response body and the status `-w` appended. */
export function splitProbeOutput(stdout: string | undefined): {
  body: string;
  status?: number;
} {
  if (!stdout) return { body: "" };
  const lastNewline = stdout.lastIndexOf("\n");
  if (lastNewline < 0) return { body: stdout };
  const tail = stdout.slice(lastNewline + 1).trim();
  if (!/^\d{3}$/.test(tail)) return { body: stdout };
  const status = Number(tail);
  // curl writes 000 when the request never completed. That is not a provider answer.
  if (status === 0) return { body: stdout.slice(0, lastNewline) };
  return { body: stdout.slice(0, lastNewline), status };
}

/** What the runner's own call to the same endpoint said about the key. */
type ControlReading =
  | { kind: "accepted"; status: number }
  | { kind: "refused"; status: number }
  | { kind: "unknown"; detail: string };

async function fetchControlProbe(
  request: ControlProbeRequest,
): Promise<ControlProbeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    return { status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve "ok" when the sandbox's model credential substitutes on the wire (or nothing can be
 * judged — fail open), and "stuck" after enough consecutive placeholder readings. Never throws.
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
  const shape = probeShapeFor(input.baseUrl, input.provider);
  const script = sandboxProbeScript(shape, input.apiKeyVar);
  // Last line of defence: no message this module writes may carry the key, whatever a future
  // edit or a provider error string puts in it.
  const controlKey = input.controlKey;
  const log = (message: string) =>
    input.log(
      controlKey && controlKey.length >= 8
        ? message.split(controlKey).join("[redacted]")
        : message,
    );

  // Started HERE so it runs concurrently with probe 1, and awaited only when a bare 401 makes
  // it the deciding evidence. One call per preflight. It never rejects, so an unawaited
  // rejection cannot escape when the sandbox answers cleanly.
  const control: Promise<ControlReading> | undefined = controlKey
    ? (input.controlProbe ?? fetchControlProbe)({
        url: shape.url,
        headers: Object.fromEntries(
          shape.headers.map(([name, value]) => [
            name,
            value.split(KEY_SLOT).join(controlKey),
          ]),
        ),
        body: shape.body,
        timeoutMs: CONTROL_TIMEOUT_MS,
      }).then(
        (response): ControlReading => {
          if (response.status === undefined)
            return { kind: "unknown", detail: "no status" };
          // 401 and 403 are the provider refusing the key itself. Everything else — a 400 for
          // the junk body, a 200, a 429 — means the provider read the key and accepted it.
          return response.status === 401 || response.status === 403
            ? { kind: "refused", status: response.status }
            : { kind: "accepted", status: response.status };
        },
        (error): ControlReading => ({
          kind: "unknown",
          detail: String(error instanceof Error ? error.message : error).slice(
            0,
            120,
          ),
        }),
      )
    : undefined;

  const startedAt = now();
  for (let attempt = 1; ; attempt++) {
    let stdout: string | undefined;
    try {
      const result = await input.sandbox.runProcess({
        command: "sh",
        args: ["-c", script],
        timeoutMs: (CURL_TIMEOUT_S + 4) * 1000,
      });
      stdout = result?.stdout;
    } catch (error) {
      // The exec channel itself failed (sandbox tearing down, daemon hiccup): fail open.
      log(
        `[credential-preflight] probe errored, proceeding: ${String(
          error instanceof Error ? error.message : error,
        ).slice(0, 120)}`,
      );
      return "ok";
    }
    const { body, status } = splitProbeOutput(stdout);
    const masked = MASKED_PLACEHOLDER_ECHO.test(body);
    // Awaited BEFORE the clock is read, so a slow control call spends the same budget every
    // other step of the preflight spends. Otherwise a control call that took most of the grace
    // would leave the loop thinking it still had time for several more probes.
    const reading =
      !masked && status === 401 && control ? await control : undefined;
    const elapsedMs = now() - startedAt;
    const elapsed = (elapsedMs / 1000).toFixed(1);

    // Evidence that the raw placeholder went out. Each instrument words its own two lines: the
    // per-probe line while the grace still runs, and the conviction line at the end.
    let evidence: { probeLine: string; stuckLine: string } | undefined;
    if (masked) {
      evidence = {
        probeLine: `raw placeholder echoed (probe ${attempt}, +${elapsed}s)`,
        stuckLine: `STUCK: raw placeholder on all ${attempt} probes (${elapsed}s)`,
      };
    } else if (status === 401) {
      // The provider refused without naming what it received. Only the control call can say
      // whether the sandbox sent a bad key or the raw placeholder.
      if (!reading) {
        log(
          `[credential-preflight] sandbox answered 401 with no echo (probe ${attempt}, ` +
            `+${elapsed}s) and the runner holds no key for a control call; proceeding`,
        );
        return "ok";
      }
      if (reading.kind === "refused") {
        log(
          `[credential-preflight] sandbox answered 401 with no echo (probe ${attempt}, ` +
            `+${elapsed}s), and the runner's own control call with the same key was ` +
            `refused (HTTP ${reading.status}): the key itself is being rejected, not its ` +
            `delivery; proceeding`,
        );
        return "ok";
      }
      if (reading.kind === "unknown") {
        log(
          `[credential-preflight] sandbox answered 401 with no echo (probe ${attempt}, ` +
            `+${elapsed}s), but the control call gave no verdict (${reading.detail}); ` +
            `proceeding`,
        );
        return "ok";
      }
      evidence = {
        probeLine:
          `bare 401 with no echo (probe ${attempt}, +${elapsed}s); the runner's own ` +
          `control call accepted the same key (HTTP ${reading.status})`,
        stuckLine:
          `STUCK: bare 401 with no echo on all ${attempt} probes (${elapsed}s) while ` +
          `the runner's own control call accepted the same key (HTTP ${reading.status})`,
      };
    }

    if (!evidence) {
      // Substituted, or the endpoint gave nothing this preflight can judge by — fail open
      // either way. An unmasked placeholder shape lands here on purpose: scrubbing produces
      // it from a healthy key too, so it is not evidence. Log it, because a stuck sandbox
      // behind an echoing endpoint now passes the preflight and surfaces as the 401 instead.
      if (body.includes("dtn_")) {
        log(
          `[credential-preflight] unmasked placeholder-shaped echo (probe ${attempt}, ` +
            `+${elapsed}s): scrubbing produces this from a REAL key ` +
            `too, so it convicts nothing; proceeding`,
        );
      } else if (attempt > 1) {
        log(
          `[credential-preflight] substitution confirmed after ${attempt} probes ` +
            `(${elapsed}s)`,
        );
      }
      return "ok";
    }
    if (elapsedMs + pollMs > budgetMs) {
      log(
        `[credential-preflight] ${evidence.stuckLine}; this sandbox will never substitute`,
      );
      return "stuck";
    }
    log(`[credential-preflight] ${evidence.probeLine}`);
    await sleep(pollMs);
  }
}

/**
 * Build the preflight's request from the acquire path's pieces.
 *
 * It exists so the kickoff's wiring is testable: `acquireEnvironment` cannot be driven without a
 * live provider, and the one property worth pinning is that the candidate's real value has
 * exactly one destination, the control call. Everything the sandbox sees is a variable name.
 */
export function credentialPreflightRequest(input: {
  baseUrl: string;
  candidate: { binding: { name: string }; value: string };
  provider?: string;
}): Pick<
  CredentialPreflightInput,
  "baseUrl" | "apiKeyVar" | "provider" | "controlKey"
> {
  return {
    baseUrl: input.baseUrl.trim(),
    apiKeyVar: input.candidate.binding.name,
    ...(input.provider ? { provider: input.provider } : {}),
    controlKey: input.candidate.value,
  };
}
