/**
 * Where the auth gate should send you, given the session verdict and where you are.
 *
 * Split out as a pure function because the interesting part is the SYMMETRY, and that is what
 * regressed: the gate only ever routed one way. A signed-out session was sent to /auth, but a
 * session that turned out to be fine while you sat there had nothing to send you back — and the
 * gate stopped re-checking on /auth, so the verdict could never be revisited. A transient 401
 * (a backend that is up but not yet serving, a refresh that raced) therefore stranded a perfectly
 * valid session on the sign-in page until a manual navigation or a hard reload.
 */
export type SessionVerdict = "ok" | "unauthenticated" | "unknown"

/** The OIDC callback completes the sign-in itself; forwarding out of it would abort the exchange. */
const isCallbackRoute = (pathname: string) => pathname.startsWith("/auth/callback")

const isAuthRoute = (pathname: string) => pathname.startsWith("/auth")

/** The route to replace with, or null to stay put. */
export const authRedirectTarget = (verdict: SessionVerdict, pathname: string): string | null => {
    if (isCallbackRoute(pathname)) return null
    if (verdict === "unauthenticated") return isAuthRoute(pathname) ? null : "/auth"
    // A confirmed session while sitting on the sign-in page: hand back to the root resolver, which
    // knows the remembered workspace/project pair. Only from a CONFIRMED verdict — "unknown" is
    // the first load, before any answer, and must not move anyone.
    if (verdict === "ok") return isAuthRoute(pathname) ? "/" : null
    return null
}

/** Whether the gate should be asking at all. It must keep asking on /auth — that is the only way a
 * stale or wrong verdict gets corrected — but never during the callback exchange. */
export const shouldCheckSession = (pathname: string) => !isCallbackRoute(pathname)
