import {useEffect, useMemo} from "react"

import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {projectAtom} from "@/oss/state/project"

const SettingsRedirect = () => {
    const router = useRouter()

    const {workspaceId} = useURL()
    const project = useAtomValue(projectAtom)

    // On a bare route urlAtom has no workspace; the project carries its own.
    const resolvedWorkspaceId = project?.workspace_id || workspaceId

    const targetPath = useMemo(() => {
        if (!resolvedWorkspaceId || !project?.project_id) return null
        return `/w/${encodeURIComponent(resolvedWorkspaceId)}/p/${encodeURIComponent(
            project.project_id,
        )}/settings`
    }, [resolvedWorkspaceId, project?.project_id])

    useEffect(() => {
        if (!router.isReady) return
        if (!targetPath) return

        const currentPath = router.asPath.split("?")[0]
        if (currentPath === targetPath) return

        const searchIndex = router.asPath.indexOf("?")
        const search = searchIndex >= 0 ? router.asPath.slice(searchIndex) : ""
        void router.replace(`${targetPath}${search}`)
    }, [router, targetPath])

    return (
        <section className="flex items-center justify-center w-full h-screen">
            <Spin spinning={true} />
        </section>
    )
}

export default SettingsRedirect
