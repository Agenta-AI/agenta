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
 * THE MECHANISM. Right after the sandbox is created, call the credential's own endpoint from
 * INSIDE the sandbox with the key env var as the credential. Several consecutive placeholder
 * readings convict the sandbox as STUCK; anything else means the header was substituted, or
 * means nothing this module can judge, and the run proceeds. The preflight runs CONCURRENTLY
 * with the rest of acquire (mounts, workspace, session open, ~10s), so a healthy sandbox pays
 * nothing.
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
 * 2. THE DIFFERENTIAL, for a provider that echoes nothing. OpenRouter answers a bad bearer with
 * a plain 401 that never names the key, and so do Anthropic and OpenAI on their auth endpoints.
 * Instrument 1 sees nothing there and fails open, so every stuck sandbox on those connections
 * became a failed first turn: 10 user-visible failures on the direct OpenRouter connection in
 * production over 2026-09-01..02 (AGE-4249). The runner itself holds the real key at this
 * point, because it created the Secret from it. So it calls the SAME auth endpoint itself,
 * concurrently with the sandbox probe, and the pair of answers is the reading.
 *
 * WHAT THE DIFFERENTIAL ACTUALLY MEASURES, STATED PLAINLY. It is a difference between two
 * REQUEST CONTEXTS — one request from inside the sandbox, one from the runner process — and it
 * attributes that difference to the credential. That attribution is an assumption, not a proof.
 * Any other environment difference between the two contexts would convict a healthy sandbox:
 * an IP allowlist on the provider account, a WAF or bot rule that treats the sandbox's egress
 * range differently, a regional block, a provider-side per-source throttle. Three things bound
 * the damage. Only a positive, documented auth answer counts as accepted (HTTP 200 from a
 * non-generation auth endpoint), so an environment difference that produces anything else is
 * unknown and fails open. A wrong verdict costs a rebuild, not a failed run, because acquire
 * retries with a fresh sandbox and the retry ladder is bounded. And the rule applies only to
 * the three direct providers whose auth endpoint is documented and pinned below; every other
 * connection, custom gateways included, keeps masked-echo-only conviction.
 *
 * ONLY A NON-GENERATION AUTH ENDPOINT, READ BY STATUS ALONE. Each differential provider has a
 * documented endpoint whose entire job is to answer whether a key is good: OpenRouter's
 * `GET /key`, Anthropic's `GET /v1/models`, OpenAI's `GET /models`. 200 means accepted, 401
 * means the key is refused, and every other status — 403, 3xx, 404, 405, 429, 5xx, a timeout —
 * is unknown and fails open. Reading the status of a purpose-built endpoint, rather than
 * inferring acceptance from "not a refusal" on a generation endpoint, is what keeps a
 * misrouted or rate-limited call from being read as proof that a key works.
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
 * probes" with N > 1). It is ONE deadline: every sandbox probe timeout and the runner's own
 * call are capped by what is left of it, so a slow probe cannot spend more than the grace.
 *
 * SCOPE. Only a freshly created Daytona sandbox whose MODEL credential rides a Daytona Secret
 * and whose connection declares an endpoint base URL. Within that, the differential covers
 * exactly three direct providers (openrouter, anthropic, openai). Every other connection —
 * a custom gateway such as the LiteLLM credits proxy, and any direct provider not named above
 * — keeps the OpenAI-compatible chat probe and masked-echo-only conviction, which is what has
 * been convicting stuck sandboxes on the credits proxy since this module shipped. Gemini is
 * not covered at all: its auth rides a query parameter rather than a header, so it needs its
 * own shape. A plaintext-env run has no placeholder; a reconnected sandbox already proved
 * itself.
 *
 * THE KEY VALUE NEVER LEAVES THIS MODULE. The sandbox command carries the env var name, which
 * the sandbox shell expands, and the runner's own call carries the value in a request header
 * only. Every log line goes through a redactor, so no future message can leak it either.
 *
 * AMBIGUITY FAILS OPEN. Any of these returns "ok" and the run proceeds: a probe that errors, a
 * body with nothing judgeable in it, an UNMASKED placeholder-shaped echo, a sandbox status that
 * is not 401, a sandbox 401 on a connection without a differential shape, and a runner call
 * that was refused, errored, timed out, or answered any status but 200. The worst outcome is
 * the pre-existing behavior, classified honestly by `classifyRunError`. Only consecutive,
 * unambiguous readings convict: a masked raw-placeholder echo, or a sandbox 401 beside a
 * runner call that the provider's own auth endpoint answered with 200.
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

/** One call the runner makes itself, with the real key, to the provider's auth endpoint. */
export interface ControlProbeRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** Aborted as soon as the preflight stops needing the answer. */
  signal: AbortSignal;
}

/** What that call answered. `status` is absent when nothing could be read. */
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
      "This sandbox never received its credential-substitution wiring: every probe from " +
        "inside it either echoed the raw placeholder back or was refused by the provider " +
        "while the same key succeeded from the runner. A fresh sandbox is required.",
    );
    this.name = "SubstitutionStuckError";
  }
}

/** Total acquire attempts when a sandbox is convicted stuck: the original plus one retry. */
export const STUCK_ACQUIRE_ATTEMPTS = 2;

export interface CredentialPreflightInput {
  sandbox: PreflightSandbox;
  /** The connection's endpoint base URL (`modelConnection.endpoint.baseUrl`). */
  baseUrl: string;
  /** The env var name holding the key in the sandbox (the Secret's placeholder). */
  apiKeyVar: string;
  /** The connection's provider family (`modelConnection.provider`). */
  provider?: string;
  /** How that provider is reached (`modelConnection.deployment`): `direct`, `custom`, ... */
  deployment?: string;
  /**
   * The real key value, used ONLY as the runner call's credential header.
   *
   * Without it the differential is unavailable and a bare 401 fails open, which is the
   * behavior that shipped before the differential existed.
   */
  controlKey?: string;
  log: (message: string) => void;
  /** Total budget from first probe to giving up (fail open). */
  budgetMs?: number;
  /** Delay between probes. */
  pollMs?: number;
  /** The acquire's cancellation signal; aborts the runner's own call with the run. */
  signal?: AbortSignal;
  /** Injectable clock/sleep/transport for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  controlProbe?: ControlProbe;
  fetchImpl?: typeof fetch;
}

/** See the module doc: 10s, deliberately below Daytona's ~30s keep-or-recreate bound. */
const DEFAULT_BUDGET_MS = 10_000;
const DEFAULT_POLL_MS = 2_000;
const PROBE_TIMEOUT_S = 8;
const CONTROL_TIMEOUT_MS = 8_000;
/** Pinned by Anthropic's API, which refuses a versionless call. */
const ANTHROPIC_VERSION = "2023-06-01";
/** A shell would expand anything else in the command string. */
const SHELL_SAFE_ENV_VAR = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
 * The request this preflight sends, in the shape the provider understands.
 *
 * `buildHeaders` takes the credential and returns the headers, so the same shape builds the
 * sandbox command (which gets a shell expansion of the env var) and the runner's own request
 * (which gets the real value). `differential` says whether a bare 401 from the sandbox may be
 * judged against the runner's answer; see the module doc for why only three providers set it.
 */
interface ProbeShape {
  method: "GET" | "POST";
  url: string;
  buildHeaders: (credential: string) => Record<string, string>;
  body?: string;
  differential: boolean;
}

/**
 * The chat probe: a POST of an empty JSON body to the OpenAI-compatible chat path.
 *
 * The default for every connection without a documented auth endpoint here. An auth-first
 * gateway answers it without running a model, and the LiteLLM credits proxy answers it with the
 * masked refusal that has been convicting stuck sandboxes since this module shipped. It carries
 * no differential: a 401 from a generation endpoint has too many causes to attribute.
 */
function chatProbeShape(base: string): ProbeShape {
  return {
    method: "POST",
    url: `${base}/chat/completions`,
    buildHeaders: (credential) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`,
    }),
    body: "{}",
    differential: false,
  };
}

/**
 * Pick the request shape from the connection's provider family and how it is reached.
 *
 * Only a DIRECT connection to one of the three providers below gets a differential shape, and
 * each one is that provider's own documented endpoint for checking a key. `deployment` matters
 * as much as `provider`: a custom gateway can carry any provider name while speaking its own
 * dialect at its own host, so the auth endpoint below would not exist there.
 */
function probeShapeFor(
  baseUrl: string,
  provider?: string,
  deployment?: string,
): ProbeShape {
  const base = baseUrl.replace(/\/+$/, "");
  if (deployment?.trim().toLowerCase() !== "direct")
    return chatProbeShape(base);
  switch (provider?.trim().toLowerCase()) {
    case "openrouter":
      // OpenRouter's documented "get current key" endpoint.
      return {
        method: "GET",
        url: `${base}/key`,
        buildHeaders: (credential) => ({
          Authorization: `Bearer ${credential}`,
        }),
        differential: true,
      };
    case "anthropic":
      // `limit=1` so the answer stays small; the status is all this reads.
      return {
        method: "GET",
        url: `${base}/v1/models?limit=1`,
        buildHeaders: (credential) => ({
          "x-api-key": credential,
          "anthropic-version": ANTHROPIC_VERSION,
        }),
        differential: true,
      };
    case "openai":
      return {
        method: "GET",
        url: `${base}/models`,
        buildHeaders: (credential) => ({
          Authorization: `Bearer ${credential}`,
        }),
        differential: true,
      };
    default:
      return chatProbeShape(base);
  }
}

/**
 * The curl the sandbox runs. `-w` appends the HTTP status on its own line, which is the
 * differential's whole input: the body alone cannot tell a refusal from a substituted call on a
 * provider that echoes nothing. The env var is expanded by the sandbox shell, so the key value
 * never appears in any runner-side string.
 */
function sandboxProbeScript(
  shape: ProbeShape,
  apiKeyVar: string,
  timeoutSeconds: number,
): string {
  const headers = Object.entries(shape.buildHeaders(`$${apiKeyVar}`))
    .map(([name, value]) => `-H "${name}: ${value}" `)
    .join("");
  const method = shape.method === "POST" ? "-X POST " : "";
  const body =
    shape.body === undefined ? "" : `-d ${JSON.stringify(shape.body)} `;
  return (
    `curl -s -m ${timeoutSeconds} -w '\\n%{http_code}' ` +
    method +
    headers +
    body +
    JSON.stringify(shape.url)
  );
}

/** Split curl's output into the response body and the status `-w` appended. */
export function parseCurlProbeOutput(stdout: string | undefined): {
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

/** What the runner's own call to the provider's auth endpoint said about the key. */
type RunnerAuthProbeResult =
  | { kind: "accepted"; status: number }
  | { kind: "refused"; status: number }
  | { kind: "unknown"; detail: string };

/**
 * Read the auth endpoint's answer. Only a 200 is acceptance and only a 401 is refusal; every
 * other status is a different fact about the request, not about the key. See the module doc.
 */
function readRunnerAuthStatus(
  status: number | undefined,
): RunnerAuthProbeResult {
  if (status === undefined) return { kind: "unknown", detail: "no status" };
  if (status === 200) return { kind: "accepted", status };
  if (status === 401) return { kind: "refused", status };
  return { kind: "unknown", detail: `HTTP ${status}` };
}

/**
 * The runner's own call, over `fetch`.
 *
 * `redirect: "error"` so a 3xx is never followed: the auth endpoint is pinned, and a redirect
 * would send the real key to whatever host the response named. The body is cancelled once the
 * status is read, because nothing here reads it and an unread body holds the connection.
 */
function createFetchControlProbe(fetchImpl: typeof fetch): ControlProbe {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: "error",
      signal: request.signal,
    });
    await response.body?.cancel().catch(() => {});
    return { status: response.status };
  };
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
  // Last line of defence: no message this module writes may carry the key, whatever a future
  // edit or a provider error string puts in it. Any non-empty value is redacted.
  const controlKey = input.controlKey;
  const log = (message: string) =>
    input.log(
      controlKey ? message.split(controlKey).join("[redacted]") : message,
    );

  // The env var name is interpolated into a shell command, so it must be a name and nothing
  // else. A value that is not one is a programming error upstream, not a stuck sandbox.
  if (!SHELL_SAFE_ENV_VAR.test(input.apiKeyVar)) {
    log(
      `[credential-preflight] refusing to probe: the credential's binding name is not a ` +
        `shell-safe environment variable name; proceeding`,
    );
    return "ok";
  }

  const shape = probeShapeFor(input.baseUrl, input.provider, input.deployment);
  const startedAt = now();
  const deadlineAt = startedAt + budgetMs;
  const remainingMs = () => Math.max(0, deadlineAt - now());

  // ONE controller for the runner's call, aborted in the `finally` below so every exit path
  // (verdict, throw, caller cancellation) releases it. Composed with the acquire's own signal
  // so a cancelled run does not leave a request in flight.
  const controlAbort = new AbortController();
  const controlSignal = input.signal
    ? AbortSignal.any([input.signal, controlAbort.signal])
    : controlAbort.signal;

  // Started HERE so it runs concurrently with probe 1, and awaited only when a bare 401 makes
  // it the deciding evidence. One call per preflight, and none at all on a connection whose
  // shape carries no differential. It never rejects, so an unawaited rejection cannot escape
  // when the sandbox answers cleanly.
  const control: Promise<RunnerAuthProbeResult> | undefined =
    controlKey && shape.differential
      ? (
          input.controlProbe ??
          createFetchControlProbe(input.fetchImpl ?? fetch)
        )({
          method: shape.method,
          url: shape.url,
          headers: shape.buildHeaders(controlKey),
          ...(shape.body === undefined ? {} : { body: shape.body }),
          timeoutMs: Math.max(1_000, Math.min(CONTROL_TIMEOUT_MS, budgetMs)),
          signal: controlSignal,
        }).then(
          (response) => readRunnerAuthStatus(response.status),
          (error): RunnerAuthProbeResult => ({
            kind: "unknown",
            detail: String(
              error instanceof Error ? error.message : error,
            ).slice(0, 120),
          }),
        )
      : undefined;

  try {
    for (let attempt = 1; ; attempt++) {
      // Every probe is capped by what is left of the one deadline, so a slow sandbox cannot
      // spend more than the grace no matter how long its exec channel takes to answer.
      const probeSeconds = Math.max(
        1,
        Math.min(PROBE_TIMEOUT_S, Math.ceil(remainingMs() / 1000)),
      );
      const script = sandboxProbeScript(shape, input.apiKeyVar, probeSeconds);
      let stdout: string | undefined;
      try {
        const result = await input.sandbox.runProcess({
          command: "sh",
          args: ["-c", script],
          timeoutMs: (probeSeconds + 4) * 1000,
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
      const { body, status } = parseCurlProbeOutput(stdout);
      const masked = MASKED_PLACEHOLDER_ECHO.test(body);
      // Awaited BEFORE the clock is read, so a slow runner call spends the same budget every
      // other step spends. Otherwise a call that took most of the grace would leave the loop
      // thinking it still had time for several more probes.
      const reading =
        !masked && status === 401 && control ? await control : undefined;
      const elapsedMs = now() - startedAt;
      const elapsed = (elapsedMs / 1000).toFixed(1);

      // Evidence that the raw placeholder went out. Each instrument words its own two lines:
      // the per-probe line while the grace still runs, and the conviction line at the end.
      let evidence: { probeLine: string; stuckLine: string } | undefined;
      if (masked) {
        evidence = {
          probeLine: `raw placeholder echoed (probe ${attempt}, +${elapsed}s)`,
          stuckLine: `STUCK: raw placeholder on all ${attempt} probes (${elapsed}s)`,
        };
      } else if (status === 401 && shape.differential) {
        // The provider refused without naming what it received. Only the runner's own call to
        // the same auth endpoint can say whether the key is bad or the delivery is.
        if (!reading) {
          log(
            `[credential-preflight] sandbox answered 401 with no echo (probe ${attempt}, ` +
              `+${elapsed}s) and the runner holds no key to check it against; proceeding`,
          );
          return "ok";
        }
        if (reading.kind === "refused") {
          log(
            `[credential-preflight] sandbox answered 401 with no echo (probe ${attempt}, ` +
              `+${elapsed}s), and the provider's auth endpoint refused the same key from ` +
              `the runner (HTTP ${reading.status}): the key itself is being rejected, not ` +
              `its delivery; proceeding`,
          );
          return "ok";
        }
        if (reading.kind === "unknown") {
          log(
            `[credential-preflight] sandbox answered 401 with no echo (probe ${attempt}, ` +
              `+${elapsed}s), but the runner's own call to the auth endpoint gave no ` +
              `verdict (${reading.detail}); proceeding`,
          );
          return "ok";
        }
        evidence = {
          probeLine:
            `bare 401 with no echo (probe ${attempt}, +${elapsed}s); the provider's auth ` +
            `endpoint accepted the same key from the runner (HTTP ${reading.status})`,
          stuckLine:
            `STUCK: bare 401 with no echo on all ${attempt} probes (${elapsed}s) while ` +
            `the provider's auth endpoint accepted the same key from the runner ` +
            `(HTTP ${reading.status})`,
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
  } finally {
    // Nothing reads the runner's call after this point, on any exit path.
    controlAbort.abort();
  }
}

/**
 * Build the preflight's input from the acquire path's pieces.
 *
 * It exists so the kickoff's wiring is testable: `acquireEnvironment` cannot be driven without a
 * live provider, and the one property worth pinning is that the candidate's real value has
 * exactly one destination, the runner's own call. Everything the sandbox sees is a variable
 * name.
 */
export function buildCredentialPreflightInput(input: {
  baseUrl: string;
  candidate: { binding: { name: string }; value: string };
  provider?: string;
  deployment?: string;
}): Pick<
  CredentialPreflightInput,
  "baseUrl" | "apiKeyVar" | "provider" | "deployment" | "controlKey"
> {
  return {
    baseUrl: input.baseUrl.trim(),
    apiKeyVar: input.candidate.binding.name,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.deployment ? { deployment: input.deployment } : {}),
    controlKey: input.candidate.value,
  };
}
