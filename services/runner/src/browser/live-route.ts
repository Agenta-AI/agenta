/**
 * `POST /browser/live {projectId, sessionId}`: the live-view link of the session's browser.
 * 400 bad body, 413 body too large, 404 no live browser, 200 `{url, headers}`, 502 lookup error.
 * The server checks the runner token before it calls this.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  BodyTooLargeError,
  normalizeProjectId,
  readBodyCapped,
  send,
  SESSION_SCOPE_BODY_MAX_BYTES,
} from "../http-io.ts";
import { browserLiveLink, type LiveLinkLookup } from "./live-link.ts";

export async function handleBrowserLiveRoute(
  req: IncomingMessage,
  res: ServerResponse,
  lookup: LiveLinkLookup = browserLiveLink,
): Promise<void> {
  // The answer carries the sandbox's preview token and the browser's own token.
  res.setHeader("cache-control", "no-store");
  let body: { sessionId?: unknown; projectId?: unknown };
  try {
    const raw = await readBodyCapped(req, SESSION_SCOPE_BODY_MAX_BYTES);
    body = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return send(res, 413, { ok: false, error: err.message });
    }
    return send(res, 400, { ok: false, error: "Invalid JSON" });
  }
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const projectId = normalizeProjectId(body?.projectId);
  if (!sessionId || !projectId) {
    return send(res, 400, {
      ok: false,
      error: "sessionId and projectId are both required",
    });
  }
  try {
    const link = await lookup({ projectId, sessionId });
    if (!link) {
      return send(res, 404, { ok: false, error: "No browser is running in this session" });
    }
    return send(res, 200, link);
  } catch (err) {
    return send(res, 502, {
      ok: false,
      error: err instanceof Error ? err.message : "browser lookup failed",
    });
  }
}
