import {useEffect} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

/**
 * The app page a project page with `?app=` moves to in beta developer mode, inside the app menu:
 * `/variants?app=<id>&tab=deployments` to `/apps/<id>/variants?tab=deployments`. Null otherwise.
 */
export const appPageTarget = (
    asPath: string,
    page: "variants" | "endpoints",
    beta: boolean,
): string | null => {
    if (!beta) return null
    const [path, search = ""] = asPath.split("?")
    const params = new URLSearchParams(search)
    const appId = params.get("app")
    if (!appId || !path.endsWith(`/${page}`)) return null
    params.delete("app")
    const rest = params.toString()
    const base = path.slice(0, -page.length - 1)
    return `${base}/apps/${encodeURIComponent(appId)}/${page}${rest ? `?${rest}` : ""}`
}

/** Moves the page to its app page in beta developer mode. True while it moves. */
export const useAppPageRedirect = (page: "variants" | "endpoints"): boolean => {
    const router = useRouter()
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const target = router.isReady ? appPageTarget(router.asPath, page, beta) : null
    useEffect(() => {
        if (target) void router.replace(target)
    }, [router, target])
    return target !== null
}
