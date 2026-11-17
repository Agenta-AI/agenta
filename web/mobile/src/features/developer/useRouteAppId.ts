import {useRouter} from "next/router"

const text = (value: unknown) => (typeof value === "string" && value ? value : null)

/**
 * The app a page shows: from the path on an `/apps/<id>/...` route, else from `?app=`.
 * `fromPath` pages sit inside the app menu, which already has the app switcher and Overview.
 */
export const useRouteAppId = (): {appId: string | null; fromPath: boolean} => {
    const {query} = useRouter()
    const fromPath = text(query.app_id)
    return {appId: fromPath ?? text(query.app), fromPath: fromPath !== null}
}
