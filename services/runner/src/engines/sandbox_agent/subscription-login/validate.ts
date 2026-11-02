/**
 * Is a login the runner read off disk fit to send to the API?
 *
 * WHY THIS EXISTS. The runner reads the login back off a file the harness owns, on disk the agent
 * itself can reach, and then hands it to the API as the project's stored credential. An ordering
 * gate asks only "is it newer", and `expires` is one number a corrupt or tampered file can carry
 * while its tokens are garbage. Such a file publishes cleanly, overwrites the good stored login,
 * and sends the connection to `needs_login`: one bad file costs the user their sign-in.
 *
 * So the runner proves the login is real against the TOKEN itself, not against anything the file
 * claims alongside it. A ChatGPT access token is a JWT whose `https://api.openai.com/auth` claim
 * carries `chatgpt_account_id`; junk cannot forge it, and another account's token cannot pass the
 * comparison.
 *
 * This is NOT authentication. The signature is not checked, because the runner holds no key and the
 * provider is the only authority on validity. It is a structural check whose whole job is to keep
 * garbage out of the vault.
 */
import { loginExpires } from "./files.ts";
import type { SubscriptionLogin } from "../../../protocol.ts";

/** The OAuth claim that names the ChatGPT account a token was issued for. */
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

/** Why a login was refused for publication. A log word, never user copy. */
export type SubscriptionLoginRejection =
  | "access_missing"
  | "access_not_jwt"
  | "account_claim_missing"
  | "account_mismatch"
  | "refresh_missing"
  | "expires_invalid"
  | "expires_past";

/** The middle segment of a JWT as an object, or undefined when it is not one. */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A login that carries NO `accountId` is accepted when the claim is present: the field is optional
 * in the credential shape, and the claim is what identifies the account.
 */
export function validateSubscriptionLogin(
  login: SubscriptionLogin | undefined,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: SubscriptionLoginRejection } {
  const reject = (
    reason: SubscriptionLoginRejection,
  ): { ok: false; reason: SubscriptionLoginRejection } => ({ ok: false, reason });
  if (!login || typeof login.access !== "string" || !login.access.trim()) {
    return reject("access_missing");
  }
  if (typeof login.refresh !== "string" || !login.refresh.trim()) {
    return reject("refresh_missing");
  }
  const expires = loginExpires(login);
  if (expires === undefined) return reject("expires_invalid");
  if (expires <= now) return reject("expires_past");

  const payload = decodeJwtPayload(login.access);
  if (!payload) return reject("access_not_jwt");
  const auth = payload[OPENAI_AUTH_CLAIM];
  const claimed =
    typeof auth === "object" && auth !== null
      ? (auth as Record<string, unknown>).chatgpt_account_id
      : undefined;
  if (typeof claimed !== "string" || !claimed) {
    return reject("account_claim_missing");
  }
  if (
    typeof login.accountId === "string" &&
    login.accountId &&
    login.accountId !== claimed
  ) {
    return reject("account_mismatch");
  }
  return { ok: true };
}
