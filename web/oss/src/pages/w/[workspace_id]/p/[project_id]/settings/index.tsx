import {useCallback, useEffect, useMemo, useState} from "react"

import {Link} from "@phosphor-icons/react"
import {Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import PageLayout from "@/oss/components/PageLayout/PageLayout"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {isEE, isToolsEnabled} from "@/oss/lib/helpers/isEE"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
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

const Tools = dynamic(() => import("@/oss/components/pages/settings/Tools/Tools"), {
    ssr: false,
})

const Organization = dynamic(() => import("@/oss/components/pages/settings/Organization"), {
    ssr: false,
})

const Settings: React.FC = () => {
    const [tabQuery] = useQueryParam("tab", undefined, "replace")
    const settingsTab = useAtomValue(settingsTabAtom)
    const tab = tabQuery ?? settingsTab ?? "workspace"
    const canShowOrganization = isEE()
    const {user} = useProfileData()
    const {selectedOrg} = useOrgData()
    const isOwner = !!selectedOrg?.owner_id && selectedOrg.owner_id === user?.id
    const canShowBilling = isEE() && isOwner
    const canShowTools = isToolsEnabled()
    const resolvedTab =
        (tab === "organization" && !canShowOrganization) ||
        (tab === "billing" && !canShowBilling) ||
        (tab === "tools" && !canShowTools)
            ? "workspace"
            : tab
    const {project} = useProjectData()
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
        const organizationLabel = isEE() ? "Organization" : "Agenta"
        return {
            settings: {
                label: (() => {
                    switch (resolvedTab) {
                        case "organization":
                            return organizationLabel
                        case "workspace":
                            return "Members"
                        case "projects":
                            return "Projects"
                        case "secrets":
                            return "Models"
                        case "tools":
                            return "Tools"
                        case "apiKeys":
                            return "API Keys"
                        case "billing":
                            return "Usage & Billing"
                        default:
                            return resolvedTab
                    }
                })(),
            },
        }
    }, [resolvedTab])

    useBreadcrumbsEffect({breadcrumbs, type: "new", condition: !!tab}, [tab])

    const isDemoOrg = selectedOrg?.flags?.is_demo ?? false

    const {content, title} = useMemo(() => {
        const organizationLabel = isEE() ? "Organization" : "Agenta"
        switch (resolvedTab) {
            case "organization":
                return {
                    content: <Organization />,
                    title: (
                        <div className="flex items-center gap-2">
                            <span>{organizationLabel}</span>
                            <Tooltip title={isOrgIdCopied ? "Copied!" : "Click to copy ID"}>
                                <Tag
                                    className="cursor-pointer flex items-center gap-1"
                                    onClick={handleCopyOrgId}
                                >
                                    <Link size={14} weight="bold" />
                                    <span>ID</span>
                                </Tag>
                            </Tooltip>
                            {isDemoOrg && (
                                <Tag className="bg-[#0517290F] m-0 font-normal">demo</Tag>
                            )}
                        </div>
                    ),
                }
            case "secrets":
                return {content: <Secrets />, title: "Models"}
            case "tools":
                return {content: <Tools />, title: "Tools"}
            case "apiKeys":
                return {content: <APIKeys />, title: "API Keys"}
            case "billing":
                return {content: <Billing />, title: "Usage & Billing"}
            case "projects":
                return {content: <ProjectsSettings />, title: "Projects"}
            default:
                return {
                    content: <WorkspaceManage />,
                    title: "Members",
                }
        }
    }, [
        resolvedTab,
        isOrgIdCopied,
        isProjectIdCopied,
        handleCopyOrgId,
        handleCopyProjectId,
        isDemoOrg,
        isOwner,
    ])

    return (
        <PageLayout key={settingsKey} title={title}>
            {content}
        </PageLayout>
    )
}

export default () => <Settings />
