/**
 * Where to put a person back when the consent flow took their whole tab.
 *
 * With popups blocked, authorizing navigates the tab away: the app is destroyed, the dialog with
 * it, and what comes back is the API's callback page. That page knows the deployment's web origin
 * and nothing else, so it used to send everyone to a bare `/settings`, which is not where the
 * connections list lives. Classic forwards a bare settings path on to the scoped one, so it only
 * looked slow; /m has no such route at all, and a person who started there came back into the
 * desktop app (UI QA round 3, D1).
 *
 * The tab that is about to be navigated away knows exactly where it stands, so it writes that down
 * first. `sessionStorage` is per tab and survives a cross-origin round trip, which is precisely the
 * journey here, and it is readable by the callback page whenever the API is served from the web
 * app's own origin, which is the usual deployment. Where it is not, nothing is stored and the page
 * falls back to the path it always used.
 */

export const MCP_RETURN_PATH_KEY = "agenta:mcp:return-path"

/**
 * Whether a stored value may be navigated to.
 *
 * Path-only and single-slash: `//evil.test` is a protocol-relative URL that a browser reads as
 * another origin, and this value is joined to an origin by the callback page. The check lives here
 * and again in that page, because each is the last line of defence where it runs.
 */
export const isSafeReturnPath = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length > 1 &&
    value.length <= 2048 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")

/**
 * Remember the page the tab is on, so the callback can bring it back here.
 *
 * Called before the tab is navigated to the provider, never on the popup path: with a popup the
 * app is still standing and the dialog completes in place.
 */
export const rememberMcpReturnPath = (location?: {pathname?: string; search?: string}): void => {
    const here = location ?? (typeof window === "undefined" ? undefined : window.location)
    if (!here) return
    const path = `${here.pathname ?? ""}${here.search ?? ""}`
    if (!isSafeReturnPath(path)) return
    try {
        window.sessionStorage.setItem(MCP_RETURN_PATH_KEY, path)
    } catch {
        // A browser that refuses storage (private mode, a blocked third-party context) still
        // authorizes fine; it lands on the fallback path instead of exactly where it was.
    }
}
