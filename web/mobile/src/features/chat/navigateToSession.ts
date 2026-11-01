import Router from "next/router"

/**
 * Route to a session without the middleware round trip: `proxy.ts` matches every route, so a plain
 * push waits on `_next/data` for a verdict that is always "pass" (the gate acts on document loads).
 */
export const navigateToSession = (path: string, mode: "push" | "replace" = "push") =>
    Router[mode](path, undefined, {shallow: true})
