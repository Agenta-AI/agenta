import {useEffect, useMemo, useRef} from "react"

import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {orgsAtom} from "@/oss/state/org"
import {buildPostLoginPath, waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

const WorkspaceSelection = () => {
    const router = useRouter()
    const orgs = useAtomValue(orgsAtom)
    const {workspaceId, baseAppURL, projectURL, orgURL} = useURL()
    const pendingRef = useRef(false)

    const fallbackPath = useMemo(() => {
        if (workspaceId) {
            if (baseAppURL) return baseAppURL
            if (projectURL) return `${projectURL}/apps`
            return `/w/${encodeURIComponent(workspaceId)}`
        }

        const fallbackWorkspace = Array.isArray(orgs) && orgs.length > 0 ? orgs[0]?.id : null
        if (fallbackWorkspace) {
            return `/w/${encodeURIComponent(fallbackWorkspace)}`
        }

        if (orgURL) return orgURL
        return null
    }, [baseAppURL, orgURL, orgs, projectURL, workspaceId])

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

        const fallbackTimer = fallbackPath
            ? setTimeout(() => {
                  void redirect(fallbackPath)
              }, 150)
            : null

        void waitForWorkspaceContext({
            timeoutMs: 1500,
            requireProjectId: false,
            requireOrgData: true,
        })
            .then(async (context) => {
                if (cancelled) return

                const resolvedPath = buildPostLoginPath(context)

                if (resolvedPath && resolvedPath !== "/w") {
                    if (fallbackTimer) clearTimeout(fallbackTimer)
                    await redirect(resolvedPath)
                    return
                }

                if (fallbackPath) {
                    if (fallbackTimer) clearTimeout(fallbackTimer)
                    await redirect(fallbackPath)
                }
            })
            .finally(() => {
                if (fallbackTimer) clearTimeout(fallbackTimer)
                pendingRef.current = false
            })

        return () => {
            cancelled = true
            if (fallbackTimer) clearTimeout(fallbackTimer)
        }
    }, [fallbackPath, router, router.isReady])

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spin spinning={true} />
        </section>
    )
}

export default WorkspaceSelection
