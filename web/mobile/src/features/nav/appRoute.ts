import {atom} from "jotai"

/**
 * Which pages show the app menu, kept apart from the menu itself: every page with a rail reads
 * this, and only a page inside an app loads the menu (`appNavScope`).
 */
const APP_ROUTE = /\/apps\/\[app_id\]\/[^/]+$/
/** Pages that show one app, with the app in `?app=`. They become `/apps/<id>/...` routes later. */
const APP_QUERY_ROUTE = /\/(variants|endpoints)$/

/** The app of a page that belongs in the app menu, else null. */
export const appScopeAppId = (
    pathname: string,
    query: Record<string, string | string[] | undefined>,
): string | null => {
    if (APP_ROUTE.test(pathname)) return typeof query.app_id === "string" ? query.app_id : null
    if (APP_QUERY_ROUTE.test(pathname)) return typeof query.app === "string" ? query.app : null
    return null
}

/** Where "Back" returns to: the last page the main rail showed. */
export const lastMainRailPathAtom = atom<string | null>(null)
