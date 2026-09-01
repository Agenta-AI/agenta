import {useEffect, useMemo} from "react"

import {NotFoundScreen} from "@agenta/auth-ui"
import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {projectAtom, workspaceContextAtom} from "@/oss/state/project"

const WorkspaceRedirect = () => {
    const router = useRouter()

    const {workspaceId, baseAppURL} = useURL()

    const project = useAtomValue(projectAtom)
    const {isNotFound} = useAtomValue(workspaceContextAtom)

    const targetPath = useMemo(() => {
        if (baseAppURL) return baseAppURL

        if (workspaceId && project?.project_id) {
            return `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
                project.project_id,
            )}/apps`
        }
        if (workspaceId) {
            return `/w/${encodeURIComponent(workspaceId)}`
        }
        return null
    }, [baseAppURL, workspaceId, project?.project_id])

    useEffect(() => {
        if (!router.isReady) return
        if (!targetPath) return

        const currentPath = router.asPath.split("?")[0]
        const nextPath = targetPath.split("?")[0]
        if (currentPath === nextPath) return

        void router.replace(targetPath)
    }, [router, targetPath])

    // The 404 belongs on this leaf: `/w/:id` matches a route, so Next never reaches its own.
    if (isNotFound) {
        return <NotFoundScreen onBack={() => router.back()} path={router.asPath} />
    }

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spin spinning={true} />
        </section>
    )
}

export default WorkspaceRedirect
