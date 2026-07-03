/**
 * The API base for runner→API calls (sessions, mounts, interactions).
 *
 * `AGENTA_API_INTERNAL_URL` is the direct in-network hop (`http://api:8000`) — the runner's
 * preferred route. `AGENTA_API_URL` is the platform-wide PUBLIC base (`http://<host>/api`,
 * proxy-shaped) and only a fallback: inside a container, a `localhost`-shaped public URL is
 * unreachable, which is why the two must stay distinct env vars.
 */
export function apiBase(): string {
  const base =
    process.env.AGENTA_API_INTERNAL_URL ??
    process.env.AGENTA_API_URL ??
    "http://api:8000";
  // Trim trailing slashes off the BASE only — callers append paths, and collection
  // endpoints keep their own trailing slash (`${base}/sessions/streams/`).
  return base.replace(/\/+$/, "");
}
