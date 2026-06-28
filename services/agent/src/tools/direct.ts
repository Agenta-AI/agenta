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
 *  - `assembleBody`  — merge the model's args with the server-fixed `body` and the run-context
 *    `context` binding (Phase 3a) per the body-assembly rules in the design.
 *  - `directCallUrl` — the SSRF guard: validate the method + path and bind the origin to the run's
 *    own Agenta, so the descriptor (untrusted input) can never reach a non-Agenta host.
 *  - `callDirect`    — the actual HTTP round-trip, reusing the run's caller credential.
 *
 * In this phase it is called only from `tools/relay.ts` `executeRelayedTool` — the live host path
 * for both local and Daytona, because both call sites relay every tool call to the host. The
 * symmetric `tools/dispatch.ts` `runResolvedTool` host-direct branch is deferred until the
 * gateway-refactor lane lands (see the PR notes); the in-sandbox child never makes the call.
 */
import type { ResolvedToolSpec, RunContext } from "../protocol.ts";
import { TOOL_CALL_TIMEOUT_MS } from "./callback.ts";

/** The resolved `call` descriptor (see `ResolvedToolSpec.call`). */
export type DirectCall = NonNullable<ResolvedToolSpec["call"]>;

/** The prefix every `call.context` value carries: `"$ctx.<dotted.path>"` (see `RunContext`). */
const CTX_TOKEN_PREFIX = "$ctx.";

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
 * Delete the value at a dotted `path` in `target`, if present. Each segment is validated the same
 * way `deepSet` does (no empty segments, no prototype-polluting keys), so this can never reach
 * through the prototype chain. A path whose parent is missing or not a plain object is a no-op.
 */
export function deepDelete(target: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  for (const part of parts) {
    if (!part) throw new Error(`invalid empty segment in path '${path}'`);
    if (UNSAFE_KEYS.has(part)) {
      throw new Error(`unsafe path segment '${part}' in '${path}'`);
    }
  }
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cursor[parts[i]];
    if (!isPlainObject(next)) return;
    cursor = next;
  }
  delete cursor[parts[parts.length - 1]];
}

/**
 * Recursively merge `overlay` onto `base`. `overlay` WINS on every conflict (so server-fixed
 * fields override the model's args); two plain objects at the same key merge, anything else
 * replaces. Prototype-polluting keys are skipped at EVERY level: a plain-object value is always
 * merged through this function (onto the existing subtree, or onto a fresh one when the base side
 * is not an object), so a nested `__proto__`/`constructor`/`prototype` carried inside an untrusted
 * subtree can never be assigned wholesale. Returns a new object; inputs are not mutated. Passing an
 * empty `base` (`deepMerge({}, value)`) is the way to deep-sanitize an untrusted object.
 */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (isPlainObject(value)) {
      const existing = isPlainObject(out[key])
        ? (out[key] as Record<string, unknown>)
        : {};
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve a `call.context` token (`"$ctx.<dotted.path>"`) against the run's `runContext` blob.
 *
 * The descriptor is untrusted, so a malformed token (one that does not start with `$ctx.`) is
 * skipped rather than trusted: it returns `undefined`. A path that does not resolve in the blob
 * (no `runContext`, a missing sub-object, or a missing key) also returns `undefined`. Only a
 * non-`undefined` resolved value is bound — `null` is a real value and binds, `undefined` does not.
 *
 * Traversal follows ONLY own, safe keys: an unsafe segment (`__proto__`/`constructor`/`prototype`)
 * or a key inherited from the prototype chain returns `undefined`, so a crafted token can never
 * resolve a value outside the run-context blob.
 */
export function resolveCtxToken(
  runContext: RunContext | undefined,
  token: string,
): unknown {
  if (typeof token !== "string" || !token.startsWith(CTX_TOKEN_PREFIX)) {
    return undefined;
  }
  if (!runContext) return undefined;
  const path = token.slice(CTX_TOKEN_PREFIX.length);
  if (!path) return undefined;
  let cursor: unknown = runContext;
  for (const part of path.split(".")) {
    if (!part || UNSAFE_KEYS.has(part)) return undefined;
    if (!isPlainObject(cursor)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cursor, part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
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
 *  3. `call.context` — the run-context binding (`{ bodyPath: "$ctx.<key>" }`), filled LAST so a
 *     bound field always wins over both the model's args and the static `body`. Each token resolves
 *     against the run's `runContext` (delivered on `/run`); a token that does not resolve is left
 *     unset (the field is simply absent), and the model never sees or sets a bound field. This is
 *     how a self-targeting tool gets its own trace/variant server-side.
 */
export function assembleBody(
  call: DirectCall,
  params: unknown,
  runContext?: RunContext,
): Record<string, unknown> {
  // 1. Model args, at args_into (deep-set) or the root. The args are model-generated (untrusted),
  //    so an object is deep-sanitized first (`deepMerge({}, ...)` strips `__proto__`/`constructor`/
  //    `prototype` at every level) before it lands at args_into or the root — a bare spread or a
  //    raw deep-set would carry a nested prototype-polluting key through unchecked.
  let body: Record<string, unknown> = {};
  const raw = params ?? {};
  const args = isPlainObject(raw) ? deepMerge({}, raw) : raw;
  if (call.args_into) {
    deepSet(body, call.args_into, args);
  } else if (isPlainObject(args)) {
    body = args;
  }
  // 2. Server-fixed fields win over the model's args.
  if (call.body) body = deepMerge(body, call.body);
  // 3. Run-context binding wins over everything (filled LAST). For each [bodyPath, token] in
  //    call.context, the field is owned by run context alone: first clear whatever the model's args
  //    or the static `body` put at that path, then deep-set the resolved value. A token that does
  //    not resolve leaves the field ABSENT (the cleared state), so a missing run-context value can
  //    never let a model-supplied value survive in a bound field — the model-invisible guarantee.
  //    deepDelete / deepSet are prototype-pollution-safe and reject unsafe path segments.
  if (call.context) {
    for (const [bodyPath, token] of Object.entries(call.context)) {
      deepDelete(body, bodyPath);
      const value = resolveCtxToken(runContext, token);
      if (value !== undefined) deepSet(body, bodyPath, value);
    }
  }
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
 *    on a self-host where the API is not under `/api`. A callback path that does not end with
 *    `/tools/call` (after a trailing slash is normalized) is rejected outright — it would otherwise
 *    derive an empty mount and silently widen the guard, so it FAILS CLOSED instead.
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
  // Confine to the callback's mount (the callback path minus a trailing `/tools/call`). The mount
  // for `http://host:8000/tools/call` is the empty string — the API at the origin root, confined
  // by the host-lock alone — so an empty mount is legitimate. But a callback path that does NOT end
  // with `/tools/call` is unexpected (the gateway always posts there), and treating it as an empty
  // mount would silently widen the guard to any same-origin path. Normalize a trailing slash, then
  // FAIL CLOSED on any other shape rather than degrade the guard.
  const CALLBACK_PATH_SUFFIX = "/tools/call";
  const callbackPath = base.pathname.replace(/\/+$/, "");
  if (!callbackPath.endsWith(CALLBACK_PATH_SUFFIX)) {
    throw new Error(
      `cannot derive Agenta API mount from callback endpoint '${callbackEndpoint}'`,
    );
  }
  const mount = callbackPath.slice(0, -CALLBACK_PATH_SUFFIX.length);
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
  // A GET sends no request body (fetch forbids it), so a non-empty assembled body would be silently
  // dropped — any model args or `args_into`/`body`/`context` field on a GET descriptor would never
  // reach the endpoint. Fail fast rather than execute a call that quietly loses its inputs. No
  // resolver emits a GET `call` with a body today; this guards a future one until a GET descriptor
  // defines a query-parameter mapping.
  if (method === "GET" && Object.keys(body).length > 0) {
    throw new Error(
      "direct-call GET cannot carry a request body; a GET descriptor must map inputs to query parameters",
    );
  }

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

  if (!response.ok) {
    // The model gets only the status code. The upstream response body can carry user data or tool
    // outputs, so it is never read or logged on this error path; the URL (the run's own Agenta
    // endpoint — no credentials, the authorization header is never logged) stays, since it is the
    // load-bearing detail for diagnosing the SSRF-guarded direct path. (`redirect: "manual"` makes
    // a 3xx a non-ok response, so it lands here too.)
    console.error(
      `direct tool call ${method} ${url} returned HTTP ${response.status}`,
    );
    throw new Error(`direct tool call failed: HTTP ${response.status}`);
  }
  return response.text();
}
