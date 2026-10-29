import Session from "supertokens-auth-react/recipe/session"

/**
 * The desktop's session refresh, as the `RefreshSession` the shared watch relay takes.
 *
 * `/m` refreshes through `supertokens-web-js` (`@agenta/auth`'s `tryRefreshSession`), so the
 * package cannot import either build — each host passes its own at the mount.
 */
export const refreshSession = (): Promise<boolean> =>
    Session.attemptRefreshingSession().catch(() => false)
