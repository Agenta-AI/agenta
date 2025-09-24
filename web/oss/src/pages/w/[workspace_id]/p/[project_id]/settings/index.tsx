import {useEffect, useMemo} from "react"

import {Typography} from "antd"
import dynamic from "next/dynamic"

import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {useProjectData} from "@/oss/state/project"

const Secrets = dynamic(() => import("@/oss/components/pages/settings/Secrets/Secrets"), {
    ssr: false,
})
const WorkspaceManage = dynamic(
    () => import("@/oss/components/pages/settings/WorkspaceManage/WorkspaceManage"),
    {ssr: false},
)
const APIKeys = dynamic(() => import("@/oss/components/pages/settings/APIKeys/APIKeys"), {
    ssr: false,
})
const Billing = dynamic(() => import("@/oss/components/pages/settings/Billing"), {
    ssr: false,
})

const Settings: React.FC = () => {
    const [tab] = useQueryParam("tab", "workspace", "replace")
    const {project} = useProjectData()
    const {redirectUrl} = useURL()

    useEffect(() => {
        if (project?.is_demo) {
            redirectUrl()
        }
    }, [project, redirectUrl])

    const breadcrumbs = useMemo(() => {
        return {
            settings: {
                label: (() => {
                    switch (tab) {
                        case "workspace":
                            return "Workspace"
                        case "secrets":
                            return "Model hub"
                        case "apiKeys":
                            return "API Keys"
                        case "billing":
                            return "Billing"
                        default:
                            return tab
                    }
                })(),
            },
        }
    }, [tab])

    useBreadcrumbsEffect({breadcrumbs, type: "new", condition: !!tab}, [tab])

    const {content, title} = useMemo(() => {
        switch (tab) {
            case "secrets":
                return {content: <Secrets />, title: "Model Hub"}
            case "apiKeys":
                return {content: <APIKeys />, title: "API Keys"}
            case "billing":
                return {content: <Billing />, title: "Usage & Billing"}
            default:
                return {content: <WorkspaceManage />, title: "Workspace"}
        }
    }, [tab])

    return (
        <main className="flex flex-col gap-4">
            <Typography.Title level={4} className="!font-medium !m-0">
                {title}
            </Typography.Title>
            {content}
        </main>
    )
}

export default () => <Settings />
