/**
 * The run credential as the runner's tool transports use it.
 *
 * The wire `ToolCallbackContext` carries the credential once, at turn start, and it lives about
 * 15 minutes. A turn can run longer, so every tool request reads the credential through
 * `ToolCallbackRuntime.credential()` immediately before it sends, and the value behind that
 * getter is a refreshed platform lease.
 */
import type { ToolCallbackContext } from "../protocol.ts";
import {
  startPlatformCredentialLease,
  type PlatformCredentialSource,
} from "../sessions/auth.ts";

/** Runner-only view of the tool callback. Never serialized; the wire type stays unchanged. */
export interface ToolCallbackRuntime {
  endpoint: string;
  credential: () => string | undefined;
}

export const RUN_CREDENTIAL_EXPIRED_ERROR = {
  code: "run_credential_expired",
  message: "The platform credential for this turn expired.",
  retryable: false,
  next_step:
    "Report that the platform credential for this turn expired, and stop retrying.",
} as const;

/** The platform refused a tool request because the run credential expired. */
export class RunCredentialExpiredError extends Error {
  readonly envelope = RUN_CREDENTIAL_EXPIRED_ERROR;

  constructor() {
    // The message is the envelope, so every path that turns a throw into tool text carries it.
    super(JSON.stringify(RUN_CREDENTIAL_EXPIRED_ERROR));
    this.name = "RunCredentialExpiredError";
  }
}

/**
 * True for the auth middleware's expired-token answer:
 * HTTP 401 with `{"detail": {"message": "Unauthorized", "reason": "expired_signature"}}`.
 */
export function isExpiredSignatureResponse(
  status: number,
  bodyText: string,
): boolean {
  if (status !== 401) return false;
  try {
    return JSON.parse(bodyText)?.detail?.reason === "expired_signature";
  } catch {
    return false;
  }
}

const TOOL_CALL_PATH = "/tools/call";

/** The platform base a callback endpoint (`<base>/tools/call`) belongs to, or undefined. */
function callbackPlatformBase(endpoint: string): string | undefined {
  const trimmed = endpoint.replace(/\/+$/, "");
  if (!trimmed.endsWith(TOOL_CALL_PATH)) return undefined;
  const base = trimmed.slice(0, -TOOL_CALL_PATH.length);
  try {
    new URL(base);
  } catch {
    return undefined;
  }
  return base;
}

/**
 * Bind one turn's tool callback to a current credential.
 *
 * `platform` is the turn's existing platform lease (the session watchdog's, or the standalone
 * turn's). It is reused only when it started from the callback credential. Otherwise the turn
 * owns a lease for the callback credential, refreshed against the base the callback already
 * sends it to, and `release` stops it. An external collector key never rides a tool call.
 */
export function startToolCallbackRuntime(
  callback: ToolCallbackContext | undefined,
  platform?: PlatformCredentialSource,
  log: (message: string) => void = (message) =>
    process.stderr.write(`${message}\n`),
): { runtime: ToolCallbackRuntime | undefined; release: () => void } {
  if (!callback) return { runtime: undefined, release: () => {} };
  const authorization = callback.authorization?.trim() ?? "";
  const runtime = (credential: () => string | undefined) => ({
    runtime: { endpoint: callback.endpoint, credential },
    release: () => {},
  });
  if (!authorization) return runtime(() => undefined);
  if (platform && platform.seed === authorization) {
    const shared = platform.credential;
    return runtime(() => shared() || undefined);
  }
  const base = callbackPlatformBase(callback.endpoint);
  if (!base) {
    log(
      "[tools] the tool callback endpoint is not <api base>/tools/call; " +
        "the tool credential will not be refreshed this turn",
    );
    return runtime(() => authorization);
  }
  const lease = startPlatformCredentialLease(base, authorization);
  return {
    runtime: { endpoint: callback.endpoint, credential: lease.credential },
    release: lease.release,
  };
}
