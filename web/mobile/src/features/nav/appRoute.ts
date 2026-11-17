import {atom} from "jotai"

/**
 * Which pages show the app menu, kept apart from the menu itself: every page with a rail reads
 * this, and only a page inside an app loads the menu (`appNavScope`).
 */
const APP_ROUTE = /\/apps\/\[app_id\]\/[^/]+$/

/** The app of a page that belongs in the app menu (`/apps/<id>/<page>`), else null. */
export const appScopeAppId = (
    pathname: string,
    query: Record<string, string | string[] | undefined>,
): string | null =>
    APP_ROUTE.test(pathname) && typeof query.app_id === "string" ? query.app_id : null

/** Where "Back" returns to: the last page the main rail showed. */
export const lastMainRailPathAtom = atom<string | null>(null)
