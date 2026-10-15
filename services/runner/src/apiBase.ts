import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The API base for runner→API calls (sessions, mounts, interactions).
 *
 * `AGENTA_API_INTERNAL_URL` is the direct in-network hop (`http://api:8000`) — the runner's
 * preferred route. `AGENTA_API_URL` is the platform-wide PUBLIC base (`http://<host>/api`,
 * proxy-shaped) and only a fallback: inside a container, a `localhost`-shaped public URL is
 * unreachable, which is why the two must stay distinct env vars. When neither is set, the base
 * inferred from a request's telemetry is scoped to that request (not a process global), so
 * concurrent requests with different bases never bleed into each other.
 *
 * A request chooses the inferred base, so it can name an external collector. The runner sends its
 * own token only to `trustedApiBase()`: the env base, or the fixed `http://api:8000` default.
 */
const requestApiBase = new AsyncLocalStorage<string>();

const DEFAULT_API_BASE = "http://api:8000";

/** Run `fn` with `base` as this request's inferred API base. */
export function runWithRequestApiBase<T>(base: string, fn: () => T): T {
  return requestApiBase.run(base, fn);
}

function configuredApiBase(): string | undefined {
  return process.env.AGENTA_API_INTERNAL_URL ?? process.env.AGENTA_API_URL;
}

// Trim trailing slashes off the BASE only: callers append paths, and collection
// endpoints keep their own trailing slash (`${base}/sessions/streams/`).
export function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/** The API base that no request can choose: the env base, or the fixed default. */
export function trustedApiBase(): string {
  return trimBase(configuredApiBase() ?? DEFAULT_API_BASE);
}

export function apiBase(): string {
  return trimBase(
    configuredApiBase() ?? requestApiBase.getStore() ?? DEFAULT_API_BASE,
  );
}

/**
 * `url` moved onto the in-network hop, when it is a route on this deployment's public api base.
 *
 * The platform composes the gateway routes it hands a run against the PUBLIC base, because a
 * Daytona sandbox has no route to the in-network one. A harness that runs inside this process
 * does have that route, and through the public base its calls leave the cluster, cross the NAT
 * and the load balancer, and come back in. Only an exact route on the configured public base is
 * moved: same origin, and a path at or under the base's path. Undefined when either base is
 * unset or `url` is anything else.
 */
export function inNetworkApiRoute(url: string): string | undefined {
  const internal = process.env.AGENTA_API_INTERNAL_URL?.trim();
  const publicBase = process.env.AGENTA_API_URL?.trim();
  if (!internal || !publicBase) return undefined;
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(publicBase);
    new URL(internal);
  } catch {
    return undefined;
  }
  if (target.origin !== base.origin || target.username || target.password) return undefined;
  const basePath = trimBase(base.pathname);
  if (target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) {
    return undefined;
  }
  return `${trimBase(internal)}${target.pathname.slice(basePath.length)}${target.search}`;
}

/** Is `url` on the operator's in-network api origin (`AGENTA_API_INTERNAL_URL`)? */
export function isInNetworkApiEndpoint(url: string | undefined): boolean {
  const internal = process.env.AGENTA_API_INTERNAL_URL?.trim();
  if (!internal || !url) return false;
  try {
    return new URL(url).origin === new URL(internal).origin;
  } catch {
    return false;
  }
}
