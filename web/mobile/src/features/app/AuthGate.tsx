import {useEffect} from "react"

import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {fetchProjects} from "@/lib/context"

/**
 * Null-rendering: routes a signed-out session to the sign-in page from ANY screen. The root
 * resolver cannot be that gate — a remembered pair forwards it away before the verdict lands.
 *
 * It reuses the projects query (same key and staleTime as `useCurrentProject` and the root
 * resolver), so the verdict costs no request of its own. Off on `/auth*` — that is where a
 * signed-out user belongs, and redirecting to it from itself would loop.
 */
export const AuthGate = () => {
    const router = useRouter()
    const onAuthRoute = router.pathname.startsWith("/auth")

    const {data} = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        enabled: !onAuthRoute,
        staleTime: 30_000,
    })

    const signedOut = data?.kind === "unauthenticated"
    useEffect(() => {
        if (signedOut && !onAuthRoute) void router.replace("/auth")
    }, [signedOut, onAuthRoute])

    return null
}
