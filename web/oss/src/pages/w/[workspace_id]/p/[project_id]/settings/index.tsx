import {useCallback, useEffect, useMemo, useState} from "react"

import {PageLayout} from "@agenta/ui"
import {Link} from "@phosphor-icons/react"
import {Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {isBillingEnabled, isEE, isToolsEnabled} from "@/oss/lib/helpers/isEE"
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

const Automations = dynamic(
    () => import("@/oss/components/pages/settings/Automations/Automations"),
    {
        ssr: false,
    },
)

interface SettingsProps {
    AuditLogComponent?: React.ComponentType
}

export const Settings: React.FC<SettingsProps> = ({AuditLogComponent}) => {
    const [tabQuery] = useQueryParam("tab", undefined, "replace")
    const settingsTab = useAtomValue(settingsTabAtom)
    const tab = tabQuery ?? settingsTab ?? "workspace"
    const {canViewApiKeys, canViewEvents} = useProjectPermissions()
    const canShowOrganization = isEE()
    const {user} = useProfileData()
    const {selectedOrg} = useOrgData()
    const isOwner = !!selectedOrg?.owner_id && selectedOrg.owner_id === user?.id
    const canShowBilling = isEE() && isOwner
    const billingEnabled = isBillingEnabled()
    const canShowTools = isToolsEnabled()
    const canShowAuditLog = isEE() && canViewEvents
    const resolvedTab =
        (tab === "organization" && !canShowOrganization) ||
        (tab === "billing" && !canShowBilling) ||
        (tab === "tools" && !canShowTools) ||
        (tab === "apiKeys" && !canViewApiKeys) ||
        (tab === "auditLog" && !canShowAuditLog)
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
        return {
            settings: {
                label: (() => {
                    switch (resolvedTab) {
                        case "organization":
                            return "Access & Security"
                        case "workspace":
                            return "Members"
                        case "projects":
                            return "Projects"
                        case "secrets":
                            return "Providers & Models"
                        case "tools":
                            return "Tools"
                        case "apiKeys":
                            return "API Keys"
                        case "automations":
                            return "Automations"
                        case "auditLog":
                            return "Audit Log"
                        case "billing":
                            return billingEnabled ? "Usage & Billing" : "Usage"
                        default:
                            return resolvedTab
                    }
                })(),
            },
        }
    }, [canViewApiKeys, resolvedTab, billingEnabled])

    useBreadcrumbsEffect({breadcrumbs, type: "new", condition: !!tab}, [tab, resolvedTab])

    const isDemoOrg = selectedOrg?.flags?.is_demo ?? false

    const {content, title} = useMemo(() => {
        switch (resolvedTab) {
            case "organization":
                return {
                    content: <Organization />,
                    title: (
                        <div className="flex items-center gap-2">
                            <span>Access & Security</span>
                            <Tooltip
                                title={isOrgIdCopied ? "Copied!" : "Click to copy organization ID"}
                            >
                                <Tag
                                    className="cursor-pointer flex items-center gap-1"
                                    onClick={handleCopyOrgId}
                                >
                                    <Link size={14} weight="bold" />
                                    <span>Organization ID</span>
                                </Tag>
                            </Tooltip>
                            {isDemoOrg && (
                                <Tag className="bg-[var(--ag-c-0517290F)] m-0 font-normal">
                                    demo
                                </Tag>
                            )}
                        </div>
                    ),
                }
            case "secrets":
                return {content: <Secrets />, title: "Providers & Models"}
            case "tools":
                return {content: <Tools />, title: "Tools"}
            case "apiKeys":
                return {content: <APIKeys />, title: "API Keys"}
            case "billing":
                return {
                    content: <Billing />,
                    title: billingEnabled ? "Usage & Billing" : "Usage",
                }
            case "automations":
                return {content: <Automations />, title: "Automations"}
            case "auditLog":
                return {
                    content: AuditLogComponent ? <AuditLogComponent /> : <WorkspaceManage />,
                    title: "Audit Log",
                }
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
        billingEnabled,
        AuditLogComponent,
    ])

    return (
        <PageLayout
            key={settingsKey}
            title={title}
            // The Audit Log tab hosts a full-height InfiniteVirtualTable, which
            // needs a bounded parent so it scrolls internally instead of growing
            // the page. Other tabs keep PageLayout's default `min-h-full` flow.
            className={resolvedTab === "auditLog" ? "h-full min-h-0" : undefined}
        >
            {content}
        </PageLayout>
    )
}

export default () => <Settings />
