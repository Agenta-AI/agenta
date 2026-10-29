import {useEffect} from "react"

import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {canonicalProjectPath, fetchProjects} from "@/lib/context"

/**
 * Rewrite `/w/<legacy workspace id>/p/<project>/...` to the project's organization id, once.
 *
 * Reads the `["mobile", "projects"]` query the screen already runs and never fetches it
 * itself (`enabled: false`): a cold cache waits for the screen's own request. Called from
 * `AppShell`, which every project-scoped screen renders.
 */
export const useCanonicalProjectRoute = () => {
    const router = useRouter()
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
        enabled: false,
    })
    const projects = query.data?.kind === "ok" ? query.data.projects : undefined
    const target = router.isReady ? canonicalProjectPath(router.asPath, projects) : null

    useEffect(() => {
        if (target) void router.replace(target, undefined, {shallow: true})
        // `router` is stable for a page; the target is what changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target])
}
