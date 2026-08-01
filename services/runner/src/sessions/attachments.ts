import { basename } from "node:path";

import { apiBase } from "../apiBase.ts";
import { envInt, envTimerMs } from "../env.ts";

export interface FetchedAttachment {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
}

type Auth = () => string;

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PER_TURN = 100;
// Aligned with the API's largest per-file cap (15 MB for audio, 10 MB for the rest): a body
// beyond it cannot be a stored attachment, so refuse it before it is held in memory.
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

function log(message: string): void {
  process.stderr.write(`[sessions/attachments] ${message}\n`);
}

export function attachmentCountError(count: number): string | null {
  const max = envInt("AGENTA_ATTACHMENTS_MAX_PER_TURN", DEFAULT_MAX_PER_TURN, {
    min: 1,
    log,
  });
  return count > max
    ? `A user turn may carry at most ${max} attachments.`
    : null;
}

export function attachmentFetchTimeoutMs(): number {
  return envTimerMs(
    "AGENTA_ATTACHMENTS_FETCH_TIMEOUT_MS",
    DEFAULT_FETCH_TIMEOUT_MS,
    { min: 1, log },
  );
}

function errorDetail(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 120);
}

function decode5987(value: string): string | null {
  const match = /^([^']*)'[^']*'(.*)$/.exec(value.trim());
  if (!match) return null;
  const charset = match[1].toLowerCase();
  try {
    if (charset === "utf-8" || charset === "utf8") {
      return decodeURIComponent(match[2]);
    }
    if (charset === "iso-8859-1" || charset === "latin1") {
      return match[2].replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
  } catch {
    return null;
  }
  return null;
}

export function sanitizeAttachmentFilename(filename: string): string | null {
  const cleaned = basename(filename.replaceAll("\\", "/")).replace(
    /[\u0000-\u001f\u007f]/g,
    "",
  );
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : null;
}

export function filenameFromContentDisposition(
  disposition: string | null,
): string | null {
  if (!disposition) return null;

  const extended = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(disposition);
  if (extended) {
    const decoded = decode5987(extended[1]);
    const sanitized = decoded && sanitizeAttachmentFilename(decoded);
    if (sanitized) return sanitized;
  }

  // The escape branch must exclude backslash from the plain branch, or the two
  // overlap and an unterminated quote backtracks exponentially (CodeQL js/redos).
  const quoted = /(?:^|;)\s*filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(
    disposition,
  );
  if (quoted) {
    const value = quoted[1].replace(/\\([\\"])/g, "$1");
    return sanitizeAttachmentFilename(value);
  }

  const plain = /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(disposition);
  return plain ? sanitizeAttachmentFilename(plain[1].trim()) : null;
}

export async function fetchAttachment(
  sessionId: string,
  attachmentId: string,
  auth: Auth,
): Promise<FetchedAttachment | null> {
  const url =
    `${apiBase()}/sessions/attachments/${encodeURIComponent(attachmentId)}/content` +
    `?session_id=${encodeURIComponent(sessionId)}`;
  try {
    const response = await fetch(url, {
      headers: { authorization: auth() },
      signal: AbortSignal.timeout(attachmentFetchTimeoutMs()),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // Content-Type parameters (charset, boundary) are not part of the MIME identity the
    // capability gate and the allowlist compare on, so keep the bare type.
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    const filename = filenameFromContentDisposition(
      response.headers.get("content-disposition"),
    );
    if (!mediaType || !filename) {
      throw new Error("missing verified attachment headers");
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_ATTACHMENT_BYTES) {
      throw new Error("attachment exceeds the maximum size");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("attachment exceeds the maximum size");
    }
    return { bytes, mediaType, filename };
  } catch (error) {
    log(
      `fetch FAILED session=${sessionId} attachment=${attachmentId}: ${errorDetail(error)}`,
    );
    return null;
  }
}

export async function claimAttachments(
  sessionId: string,
  attachmentIds: string[],
  auth: Auth,
): Promise<boolean> {
  if (attachmentIds.length === 0) return true;
  const url = `${apiBase()}/sessions/attachments/reference`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth(),
      },
      body: JSON.stringify({
        session_id: sessionId,
        attachment_ids: attachmentIds,
      }),
      signal: AbortSignal.timeout(attachmentFetchTimeoutMs()),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    log(
      `claim FAILED session=${sessionId} attachments=${attachmentIds.length}: ${errorDetail(error)}`,
    );
    return false;
  }
}
