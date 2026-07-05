import {useEffect, useMemo, useRef} from "react"

import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"

import useURL from "@/oss/hooks/useURL"
import {orgsAtom, orgsQueryAtom, resolveWorkspaceIdForOrg} from "@/oss/state/org"
import {
    buildPostLoginPathResolved,
    waitForWorkspaceContext,
} from "@/oss/state/url/postLoginRedirect"

const WorkspaceSelection = () => {
    const router = useRouter()
    const orgs = useAtomValue(orgsAtom)
    const orgsQuery = useAtomValue(orgsQueryAtom) as any
    const {workspaceId, baseAppURL, projectURL, orgURL} = useURL()
    const pendingRef = useRef(false)

    const directPath = useMemo(() => {
        if (!workspaceId) return null
        if (baseAppURL) return baseAppURL
        if (projectURL) return `${projectURL}/apps`
        return `/w/${encodeURIComponent(workspaceId)}`
    }, [baseAppURL, projectURL, workspaceId])

    useEffect(() => {
        if (!router.isReady) return

        if (pendingRef.current) return

        pendingRef.current = true

        let cancelled = false
        const redirect = async (target: string | null) => {
            if (!target || cancelled) return
            const normalizedTarget = target.split("?")[0]
            const latestPath = router.asPath.split("?")[0]
            if (normalizedTarget === latestPath) return
            await router.replace(target)
        }

        // Never use the org id as a workspace; resolve its default_workspace.id.
        const resolveFallbackPath = async (): Promise<string | null> => {
            if (directPath) return directPath
            const orgId = Array.isArray(orgs) && orgs.length > 0 ? orgs[0]?.id : null
            const resolvedWorkspaceId = await resolveWorkspaceIdForOrg(orgId)
            if (cancelled) return null
            if (resolvedWorkspaceId) return `/w/${encodeURIComponent(resolvedWorkspaceId)}`
            return orgURL ?? null
        }

        void waitForWorkspaceContext({
            timeoutMs: 1500,
            requireProjectId: false,
            requireOrgData: true,
        })
            .then(async (context) => {
                if (cancelled) return

                const resolvedPath = await buildPostLoginPathResolved(context)
                if (cancelled) return

                if (resolvedPath && resolvedPath !== "/w") {
                    await redirect(resolvedPath)
                    return
                }

                const fallbackPath = await resolveFallbackPath()
                if (fallbackPath) {
                    await redirect(fallbackPath)
                    return
                }

                // Query is settled and no orgs are available — sign out
                const querySettled = !orgsQuery?.isPending && !orgsQuery?.isFetching
                if (querySettled && orgs.length === 0) {
                    await signOut()
                    await router.replace("/auth")
                }
            })
            .finally(() => {
                pendingRef.current = false
            })

        return () => {
            cancelled = true
        }
    }, [directPath, orgURL, orgs, router, router.isReady])

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spinner />
        </section>
    )
}

export default WorkspaceSelection
