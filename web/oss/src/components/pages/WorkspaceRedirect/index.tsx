import {useEffect, useMemo} from "react"

import {Spin} from "antd"
import {useRouter} from "next/router"
import {useAtomValue} from "jotai"

import useURL from "@/oss/hooks/useURL"
import {projectsAtom} from "@/oss/state/project"

const WorkspaceRedirect = () => {
    const router = useRouter()
    const projects = useAtomValue(projectsAtom)
    const {workspaceId, baseAppURL} = useURL()

    const fallbackProjectId = useMemo(() => {
        if (!workspaceId || !Array.isArray(projects)) return null
        const belonging = projects.filter((project) => {
            const workspaceMatch = project.workspace_id === workspaceId
            const organizationMatch = project.organization_id === workspaceId
            return workspaceMatch || organizationMatch
        })
        if (!belonging.length) return null
        const nonDemo = belonging.find((project) => !project.is_demo)
        return (nonDemo ?? belonging[0])?.project_id ?? null
    }, [projects, workspaceId])

    const targetPath = useMemo(() => {
        if (baseAppURL) return baseAppURL
        if (workspaceId && fallbackProjectId) {
            return `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
                fallbackProjectId,
            )}/apps`
        }
        if (workspaceId) {
            return `/w/${encodeURIComponent(workspaceId)}`
        }
        return null
    }, [baseAppURL, fallbackProjectId, workspaceId])

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
