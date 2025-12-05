import {useEffect} from "react"

import {Spin} from "antd"
import {useRouter} from "next/router"

const AppOverviewRedirect = () => {
    const router = useRouter()

    useEffect(() => {
        if (!router.isReady) return

        const workspaceId = ensureString(router.query.workspace_id)
        const projectId = ensureString(router.query.project_id)
        const appId = ensureString(router.query.app_id)

        if (!workspaceId || !projectId || !appId) {
            void router.replace("/404")
            return
        }

        const destination = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
            projectId,
        )}/apps/${encodeURIComponent(appId)}/overview`

        if (router.asPath !== destination) {
            void router.replace(destination)
        }
    }, [router])

    return (
        <section className="flex h-screen w-full items-center justify-center">
            <Spin spinning={true} />
        </section>
    )
}

const ensureString = (value: string | string[] | undefined) => {
    if (!value) return null
    return Array.isArray(value) ? value[0] : value
}

export default AppOverviewRedirect
