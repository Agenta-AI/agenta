/**
 * Fixtures for hosted subscription logins.
 *
 * WHY THESE EXIST. The runner refuses to publish a login it cannot recognize as a real ChatGPT
 * credential, because a corrupt or tampered `auth.json` once carried a later `expires` past every
 * "is it newer" gate and overwrote the good stored login. That check reads the access token's own
 * claims, so a test fixture of `access: "new-access"` is no longer a login the runner will send —
 * it is exactly the garbage the check exists to stop.
 *
 * So a test that expects a push has to hand over something shaped like the real thing. These
 * helpers mint that shape. They are NOT credentials: the signature is a fixed placeholder and the
 * runner never verifies one, because it holds no key and the provider is the only authority on
 * whether a token is valid.
 */
import type { SubscriptionLogin } from "../../src/protocol.ts";

/** The provider's namespaced claim that names the account a token was issued for. */
export const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

function base64url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

/**
 * An access token of the real shape: three base64url segments whose payload carries
 * `https://api.openai.com/auth`.`chatgpt_account_id`. Read off a live token on 2026-09-08.
 *
 * `claims` is merged into the payload so a test can build a token that is well formed but WRONG —
 * a different account, a missing claim — which is what the negative cases need.
 */
export function accessToken(
  accountId: string | undefined,
  claims: Record<string, unknown> = {},
): string {
  const payload: Record<string, unknown> = {
    iss: "https://auth.openai.com",
    aud: "app_test",
    exp: 4_102_444_800,
    ...(accountId === undefined
      ? {}
      : { [OPENAI_AUTH_CLAIM]: { chatgpt_account_id: accountId } }),
    ...claims,
  };
  return [
    base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64url(JSON.stringify(payload)),
    "not-a-real-signature",
  ].join(".");
}

/**
 * A login the runner will publish: a real-shaped token, a refresh string, and an expiry in the
 * future. `expires` defaults to an hour out, because the runner refuses to publish a login that
 * has already expired.
 */
export function makeLogin(overrides: Partial<SubscriptionLogin> = {}): SubscriptionLogin {
  const accountId =
    typeof overrides.accountId === "string" ? overrides.accountId : "acct_1";
  return {
    type: "oauth",
    access: accessToken(accountId),
    refresh: "refresh-token",
    expires: Date.now() + 3_600_000,
    accountId,
    ...overrides,
  };
}
