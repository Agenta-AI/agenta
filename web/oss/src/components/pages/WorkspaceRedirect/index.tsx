import {useEffect, useMemo} from "react"

import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {projectAtom} from "@/oss/state/project"

const WorkspaceRedirect = () => {
    const router = useRouter()

    const {workspaceId, baseAppURL} = useURL()

    const project = useAtomValue(projectAtom)

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

    if (targetPath && router.asPath.split("?")[0] === targetPath.split("?")[0]) {
        return null
    }

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spin spinning={true} />
        </section>
    )
}

export default WorkspaceRedirect
