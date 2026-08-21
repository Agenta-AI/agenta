import {useEffect} from "react"

import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {fetchProjects} from "@/lib/context"

import {authRedirectTarget, shouldCheckSession, type SessionVerdict} from "./authRoute"

/**
 * Null-rendering: routes a signed-out session to the sign-in page from ANY screen, and a session
 * that turns out to be valid back OUT of it. The root resolver cannot be that gate — a remembered
 * pair forwards it away before the verdict lands.
 *
 * It reuses the projects query (same key and staleTime as `useCurrentProject` and the root
 * resolver), so the verdict costs no request of its own.
 *
 * It keeps asking on /auth. It used to stop there, which sounds harmless — that is where a
 * signed-out user belongs — but it made a wrong verdict permanent: one transient 401 (a backend
 * that is up but not yet serving) bounced you to the sign-in page, and nothing ever re-checked, so
 * a session that was fine the whole time stayed stranded until a hard reload. The redirect guards
 * live in `authRedirectTarget`, so re-checking cannot loop.
 */
export const AuthGate = () => {
    const router = useRouter()
    const enabled = shouldCheckSession(router.pathname)

    const {data} = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        enabled,
        staleTime: 30_000,
        // Overrides this app's `refetchOnWindowFocus: false` default, for this query only. It is
        // the gate's ONLY re-check trigger: staleTime does not schedule anything, and with the
        // default off a wrong verdict had no way at all to be revisited — a hard reload was the
        // only escape. Coming back to the tab now re-asks.
        refetchOnWindowFocus: true,
    })

    const verdict: SessionVerdict =
        data?.kind === "unauthenticated"
            ? "unauthenticated"
            : data?.kind === "ok"
              ? "ok"
              : "unknown"
    const target = authRedirectTarget(verdict, router.pathname)
    useEffect(() => {
        if (target) void router.replace(target)
        // The target string is the only trigger. The router object changes identity on every
        // navigation, so including it would re-fire the redirect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target])

    return null
}
