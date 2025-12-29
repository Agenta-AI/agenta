import {useCallback, useEffect, useMemo, useState} from "react"

import {Link} from "@phosphor-icons/react"
import {Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import PageLayout from "@/oss/components/PageLayout/PageLayout"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {useOrgData} from "@/oss/state/org"
import {useProjectData} from "@/oss/state/project"
import {settingsTabAtom} from "@/oss/state/settings"

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

const ProjectsSettings = dynamic(() => import("@/oss/components/pages/settings/Projects"), {
    ssr: false,
})

const Organization = dynamic(() => import("@/oss/components/pages/settings/Organization"), {
    ssr: false,
})

const Settings: React.FC = () => {
    const [tabQuery] = useQueryParam("tab", undefined, "replace")
    const settingsTab = useAtomValue(settingsTabAtom)
    const tab = tabQuery ?? settingsTab ?? "workspace"
    const {project} = useProjectData()
    const {selectedOrg} = useOrgData()
    const {redirectUrl} = useURL()
    const [isOrgIdCopied, setIsOrgIdCopied] = useState(false)
    const [isProjectIdCopied, setIsProjectIdCopied] = useState(false)
    const settingsKey = `${selectedOrg?.id ?? "org"}:${project?.project_id ?? "project"}`

    useEffect(() => {
        if (project?.is_demo) {
            redirectUrl()
        }
    }, [project, redirectUrl])

    const handleCopyOrgId = useCallback(async () => {
        if (!selectedOrg?.id) return
        await copyToClipboard(selectedOrg.id, false)
        setIsOrgIdCopied(true)
        setTimeout(() => setIsOrgIdCopied(false), 2000)
    }, [selectedOrg?.id])

    const handleCopyProjectId = useCallback(async () => {
        const workspaceId = selectedOrg?.default_workspace?.id
        if (!workspaceId) return
        await copyToClipboard(workspaceId, false)
        setIsProjectIdCopied(true)
        setTimeout(() => setIsProjectIdCopied(false), 2000)
    }, [selectedOrg?.default_workspace?.id])

    const breadcrumbs = useMemo(() => {
        return {
            settings: {
                label: (() => {
                    switch (tab) {
                        case "organization":
                            return "Organization"
                        case "workspace":
                            return "Project"
                        case "projects":
                            return "Projects"
                        case "secrets":
                            return "Providers & Models"
                        case "apiKeys":
                            return "Credentials"
                        case "billing":
                            return "Usage & Billing"
                        default:
                            return tab
                    }
                })(),
            },
        }
    }, [tab])

    useBreadcrumbsEffect({breadcrumbs, type: "new", condition: !!tab}, [tab])

    const isPersonalOrg = selectedOrg?.flags?.is_personal ?? true
    const isDemoOrg = selectedOrg?.flags?.is_demo ?? false

    const {content, title} = useMemo(() => {
        switch (tab) {
            case "organization":
                return {
                    content: <Organization />,
                    title: (
                        <div className="flex items-center gap-2">
                            <span>Organization</span>
                            <Tooltip title={isOrgIdCopied ? "Copied!" : "Click to copy ID"}>
                                <Tag
                                    className="cursor-pointer flex items-center gap-1"
                                    onClick={handleCopyOrgId}
                                >
                                    <Link size={14} weight="bold" />
                                    <span>ID</span>
                                </Tag>
                            </Tooltip>
                            {isPersonalOrg && <Tag className="bg-[#0517290F] m-0 font-normal">personal</Tag>}
                            {isDemoOrg && <Tag className="bg-[#0517290F] m-0 font-normal">demo</Tag>}
                        </div>
                    ),
                }
            case "secrets":
                return {content: <Secrets />, title: "Providers & Models"}
            case "apiKeys":
                return {content: <APIKeys />, title: "Credentials"}
            case "billing":
                return {content: <Billing />, title: "Usage & Billing"}
            case "projects":
                return {content: <ProjectsSettings />, title: "Projects"}
            default:
                return {
                    content: <WorkspaceManage />,
                    title: (
                        <div className="flex items-center gap-2">
                            <span>Project</span>
                            <Tooltip title={isProjectIdCopied ? "Copied!" : "Click to copy ID"}>
                                <Tag
                                    className="cursor-pointer flex items-center gap-1"
                                    onClick={handleCopyProjectId}
                                >
                                    <Link size={14} weight="bold" />
                                    <span>ID</span>
                                </Tag>
                            </Tooltip>
                        </div>
                    ),
                }
        }
    }, [tab, isOrgIdCopied, isProjectIdCopied, handleCopyOrgId, handleCopyProjectId, isPersonalOrg, isDemoOrg])

    return (
        <PageLayout key={settingsKey} title={title}>
            {content}
        </PageLayout>
    )
}

export default () => <Settings />
