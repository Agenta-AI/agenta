/** Request-body reading and JSON answers shared by the runner's HTTP routes. */
import type { IncomingMessage, ServerResponse } from "node:http";

export function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** A `{ sessionId, projectId }` body is a few hundred bytes at most. */
export const SESSION_SCOPE_BODY_MAX_BYTES = 16 * 1024;

/**
 * A body's `projectId`, or `undefined` for both absent and whitespace-only input. A blank string
 * surviving as `""` would make `/kill`'s `poolKeyFor` and `destroyInFlightSandboxesForSession`
 * disagree on scope: the former forms no pool key from an empty project id (so keepalive pool
 * entries are NOT destroyed), while the latter treats `""` as "no project filter" and still
 * destroys every in-flight sandbox for the session regardless of project.
 */
export function normalizeProjectId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Thrown by `readBodyCapped` when the request exceeds `maxBytes`; the caller maps it to 413. */
export class BodyTooLargeError extends Error {}

/** Same streaming byte-count-and-reject shape as tool-mcp-http.ts's `readBody`, so a caller
 *  cannot force the runner to buffer an arbitrarily large body before JSON parsing. */
export function readBodyCapped(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new BodyTooLargeError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
