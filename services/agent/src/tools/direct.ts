/**
 * Direct-call tool transport (direct-call tools, Phase 2).
 *
 * A resolved callback tool can carry a `call` descriptor instead of a `callRef`. When it does,
 * the runner calls that Agenta endpoint DIRECTLY — reference tools (a stored workflow invoked as
 * a tool) and platform tools (an existing Agenta endpoint exposed to the harness) — instead of
 * routing through the shared `/tools/call` gateway. Only gateway (Composio) tools still route
 * through `/tools/call`, because only the server can read the Composio secret.
 *
 * This module owns the three pieces of a direct call so both dispatch paths share one
 * implementation:
 *  - `assembleBody`  — merge the model's args with the server-fixed `body` (and, in Phase 3, the
 *    run-context `context` binding) per the body-assembly rules in the design.
 *  - `directCallUrl` — the SSRF guard: validate the method + path and bind the origin to the run's
 *    own Agenta, so the descriptor (untrusted input) can never reach a non-Agenta host.
 *  - `callDirect`    — the actual HTTP round-trip, reusing the run's caller credential.
 *
 * In this phase it is called only from `tools/relay.ts` `executeRelayedTool` — the live host path
 * for both local and Daytona, because both call sites relay every tool call to the host. The
 * symmetric `tools/dispatch.ts` `runResolvedTool` host-direct branch is deferred until the
 * gateway-refactor lane lands (see the PR notes); the in-sandbox child never makes the call.
 */
import type { ResolvedToolSpec } from "../protocol.ts";
import { TOOL_CALL_TIMEOUT_MS } from "./callback.ts";

/** The resolved `call` descriptor (see `ResolvedToolSpec.call`). */
export type DirectCall = NonNullable<ResolvedToolSpec["call"]>;

/** Methods a direct call may use. The descriptor is untrusted, so this is an allowlist. */
const DIRECT_CALL_METHODS = new Set(["GET", "POST"]);

/**
 * Object keys that must never be written through a dotted path or a merge: assigning to them
 * mutates the prototype chain (prototype pollution). Rejected in `deepSet` and skipped in
 * `deepMerge`.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** A non-null, non-array object. Used so merges/sets only recurse into real maps. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-set `value` at a dotted `path` in `target`, creating intermediate objects. Each segment is
 * validated: empty segments and prototype-polluting keys (`__proto__`/`constructor`/`prototype`)
 * are rejected. An intermediate that is not a plain object is replaced with one.
 */
export function deepSet(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  for (const part of parts) {
    if (!part) throw new Error(`invalid empty segment in path '${path}'`);
    if (UNSAFE_KEYS.has(part)) {
      throw new Error(`unsafe path segment '${part}' in '${path}'`);
    }
  }
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * Recursively merge `overlay` onto `base`. `overlay` WINS on every conflict (so server-fixed
 * fields override the model's args); two plain objects at the same key merge, anything else
 * replaces. Prototype-polluting keys in `overlay` are skipped. Returns a new object; inputs are
 * not mutated.
 */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Build the request body for a direct call from the model's `params` and the descriptor.
 *
 * Merge order (later wins):
 *  1. The model's args, placed at `call.args_into` (a dotted deep-set path, e.g. `data.inputs`
 *     for a reference invoke) or, when absent, merged at the body root. Non-object args with no
 *     `args_into` have nowhere safe to land at the root, so they are dropped.
 *  2. `call.body` — static server-fixed fields baked at resolve time (e.g. a reference's
 *     `references.workflow_revision.id`). These OVERLAY the model's args, so the model can never
 *     retarget or override a fixed field.
 *  3. `call.context` — the run-context binding ($ctx.<key> from the run's `runContext`), filled
 *     LAST so a bound field always wins. THIS IS A PHASE 3 SEAM: `runContext` is not wired yet,
 *     so Phase 2 does not apply it (and nothing emits `context` yet). See the TODO below.
 */
export function assembleBody(
  call: DirectCall,
  params: unknown,
): Record<string, unknown> {
  // 1. Model args, at args_into (deep-set) or the root.
  let body: Record<string, unknown> = {};
  const args = params ?? {};
  if (call.args_into) {
    deepSet(body, call.args_into, args);
  } else if (isPlainObject(args)) {
    body = { ...args };
  }
  // 2. Server-fixed fields win over the model's args.
  if (call.body) body = deepMerge(body, call.body);
  // 3. Run-context binding (`call.context`) is Phase 3. It depends on the `runContext` payload on
  //    `/run`, which is not wired yet, so it is intentionally NOT applied here and no resolver
  //    emits it. Filling it last (context wins) is the documented merge rule.
  //    TODO(Phase 3): for each [bodyPath, "$ctx.<key>"] in call.context, resolve <key> against
  //    the run's runContext blob and deepSet(body, bodyPath, value) — context overrides all.
  return body;
}

/**
 * Validate the descriptor and build the absolute URL to call. The `call` is untrusted input, so
 * this is the SSRF guard, and it makes NO assumption about where the Agenta API is mounted:
 *  - `method` must be on the allowlist (GET/POST);
 *  - `path` must be a single absolute-path reference — a string starting with exactly one `/`
 *    (no scheme, no protocol-relative `//host`, no backslashes, no whitespace/CRLF, no literal
 *    `..` traversal);
 *  - the path is RESOLVED against the origin of the run's own `callbackEndpoint` (the `/tools/call`
 *    URL the gateway already uses), and the resolved origin must equal that origin — a true
 *    host-lock, so a tool can never reach a non-Agenta host even via a percent-encoded escape
 *    (`/api/%2e%2e/...`) that URL-normalizes to another path;
 *  - the resolved path must stay under the callback's MOUNT — the callback path minus its trailing
 *    `/tools/call` (e.g. `/api` for `https://host/api/tools/call`, or `` for an OSS self-host at
 *    `http://host:8000/tools/call`). A non-empty mount must contain the path, so a normalized
 *    escape out of the API surface is rejected; an empty mount (API at the origin root) relies on
 *    the host-lock alone. Deriving the mount instead of hard-coding `/api` is what lets this work
 *    on a self-host where the API is not under `/api`.
 */
export function directCallUrl(callbackEndpoint: string, call: DirectCall): string {
  if (!DIRECT_CALL_METHODS.has(call.method)) {
    throw new Error(
      `direct-call method '${call.method}' is not allowed (GET/POST only)`,
    );
  }
  const path = call.path;
  // A single absolute-path reference: a string starting with exactly one `/`. Rejects non-strings,
  // scheme-qualified URLs (`https://…` does not start with `/`) and protocol-relative `//host`.
  if (typeof path !== "string" || path[0] !== "/" || path[1] === "/") {
    throw new Error(
      `direct-call path '${path}' must be an absolute path starting with a single '/'`,
    );
  }
  // Reject the obvious traversal/encoding tricks up front (defense in depth; the host-lock and
  // mount check below also catch a normalized escape).
  if (path.includes("..") || path.includes("\\") || /\s/.test(path)) {
    throw new Error(`direct-call path '${path}' is not a safe relative path`);
  }
  let base: URL;
  try {
    base = new URL(callbackEndpoint);
  } catch {
    throw new Error(
      `cannot derive Agenta origin from callback endpoint '${callbackEndpoint}'`,
    );
  }
  if (base.origin === "null") {
    throw new Error(
      `callback endpoint '${callbackEndpoint}' has no usable origin`,
    );
  }
  // Resolve against the callback origin and host-lock: the resolved origin must equal it. This
  // binds every direct call to the run's own Agenta, whatever the path normalizes to.
  let resolved: URL;
  try {
    resolved = new URL(path, base.origin);
  } catch {
    throw new Error(`direct-call path '${path}' is not a valid path`);
  }
  if (resolved.origin !== base.origin) {
    throw new Error(
      `direct-call path '${path}' resolves outside the run's Agenta origin`,
    );
  }
  // Confine to the callback's mount (the callback path minus a trailing `/tools/call`). An empty
  // mount (API at the root) imposes no prefix; a non-empty mount must contain the resolved path,
  // so a normalized escape like `/api/%2e%2e/admin` -> `/admin` is rejected.
  const CALLBACK_PATH_SUFFIX = "/tools/call";
  const mount = base.pathname.endsWith(CALLBACK_PATH_SUFFIX)
    ? base.pathname.slice(0, -CALLBACK_PATH_SUFFIX.length)
    : "";
  if (
    mount &&
    resolved.pathname !== mount &&
    !resolved.pathname.startsWith(`${mount}/`)
  ) {
    throw new Error(
      `direct-call path '${path}' is outside the Agenta API mount '${mount}'`,
    );
  }
  return resolved.toString();
}

/**
 * One direct call to an Agenta endpoint. Reuses the run's caller credential (`authorization`),
 * combines an optional caller `signal` with the per-tool timeout, and returns the response text
 * verbatim for the model. Throws on a transport error or a non-2xx status; callers turn the throw
 * into a tool-error result so the model loop continues.
 *
 * The response is returned as-is (the body text). Endpoint-specific result shaping — e.g. lifting
 * a reference invoke's `data.outputs` + `trace_id` — is Phase 4, when the reference resolver
 * starts emitting `call`.
 */
export async function callDirect(
  method: "GET" | "POST",
  url: string,
  authorization: string | undefined,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authorization) headers["authorization"] = authorization;

  const timeoutSignal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS);
  const anyOf = (AbortSignal as any).any;
  const combined =
    signal && typeof anyOf === "function"
      ? anyOf([signal, timeoutSignal])
      : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      // GET carries no body (fetch forbids it); POST sends the assembled JSON body.
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: combined,
      // Do not auto-follow redirects: a 3xx to another host would defeat the origin lock in
      // directCallUrl (SSRF-via-redirect). A 3xx surfaces here as a non-ok response and fails
      // closed below — we never chase it.
      redirect: "manual",
    });
  } catch (err) {
    // Log the detail server-side; the model gets a generic message so the resolved internal URL
    // and the transport error never leak into the tool result.
    console.error(
      `direct tool call ${method} ${url} transport error:`,
      err instanceof Error ? err.message : String(err),
    );
    throw new Error("direct tool call failed");
  }

  const bodyText = await response.text();
  if (!response.ok) {
    // Keep the internal URL and the upstream response body server-side; the model gets only the
    // status code. (`redirect: "manual"` makes a 3xx a non-ok response, so it lands here too.)
    console.error(
      `direct tool call ${method} ${url} returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
    );
    throw new Error(`direct tool call failed: HTTP ${response.status}`);
  }
  return bodyText;
}
