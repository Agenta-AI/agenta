/**
 * The folder-scoped token the bridge attaches to every file call (lane A, server half in
 * `api/oss/src/core/apps/scope_token.py`).
 *
 * Path scoping used to live only here, in the page. That made every exit the app might find
 * load-bearing — one missed path check and an app reached the whole mount, which happened. The
 * token moves the folder rule to the server: it names the mount, the folder and the level, the
 * API refuses anything outside, and a bug in this file stops being the only thing standing there.
 *
 * It NARROWS. Without it a call is an ordinary drive request, which is how the Files pane and
 * every other drive surface are unaffected; with it the same call is additionally bounded. An app
 * never runs unscoped: when no token can be minted, the app's file calls fail (see `fsClient`).
 *
 * One token per mount+dir+level, cached and re-minted a minute before it lapses so a long-running
 * app never has a call fail on expiry. A token the server rejects is dropped with
 * {@link dropScopeToken} and minted again once.
 */

import {getMountsClient, projectScopedRequest} from "@agenta/entities/session"

import type {GrantLevel} from "./protocol"

/** Header the mounts router reads. Must match `x_agenta_app_scope` on the API. */
export const SCOPE_HEADER = "X-Agenta-App-Scope"

/** Re-mint this long before expiry, so an in-flight call never lands on a lapsed token. */
const REFRESH_MARGIN_MS = 60_000

interface CachedToken {
    token: string
    /** Epoch millis. */
    expiresAt: number
}

const cache = new Map<string, CachedToken>()
const inflight = new Map<string, Promise<string | null>>()

const cacheKey = (mountId: string, dir: string, level: GrantLevel) => `${mountId}|${dir}|${level}`

/** Forget one cached token, so the next call mints a fresh one (the server rejected it). */
export function dropScopeToken(mountId: string, dir: string, level: GrantLevel): void {
    cache.delete(cacheKey(mountId, dir, level))
}

/** Drop every cached token (a sign-out, or a test). */
export function clearScopeTokens(): void {
    cache.clear()
    inflight.clear()
}

async function mint(
    mountId: string,
    projectId: string,
    dir: string,
    level: GrantLevel,
): Promise<string | null> {
    try {
        const {token, expires_at: expiresAt} = await getMountsClient().mintAppScopeToken(
            {mount_id: mountId, dir, level},
            projectScopedRequest(projectId),
        )
        if (typeof token !== "string" || typeof expiresAt !== "number") return null
        cache.set(cacheKey(mountId, dir, level), {token, expiresAt: expiresAt * 1000})
        return token
    } catch {
        // The caller fails closed on null: an app never falls back to unscoped drive access.
        return null
    }
}

/** The token for this app, minting or refreshing as needed. Resolves null when none can be minted. */
export async function getScopeToken(
    mountId: string,
    projectId: string,
    dir: string,
    level: GrantLevel,
): Promise<string | null> {
    const key = cacheKey(mountId, dir, level)

    const cached = cache.get(key)
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token

    // Collapse a burst of parallel fs calls onto one mint.
    const existing = inflight.get(key)
    if (existing) return existing

    const pending = mint(mountId, projectId, dir, level).finally(() => {
        inflight.delete(key)
    })
    inflight.set(key, pending)
    return pending
}

/** `{[SCOPE_HEADER]: token}`, or `{}` when there is no token to send. */
export const scopeHeaders = (token: string | null): Record<string, string> =>
    token ? {[SCOPE_HEADER]: token} : {}
