import {useCallback, useEffect, useMemo, useState} from "react"

import {PageLayout} from "@agenta/ui"
import {Link} from "@phosphor-icons/react"
import {Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {
    DEFAULT_SETTINGS_TAB,
    getSettingsTabLabel,
    resolveSettingsTab,
} from "@/oss/components/pages/settings/assets/navigation"
import {useSettingsAccess} from "@/oss/components/pages/settings/hooks/useSettingsAccess"
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
const Vault = dynamic(() => import("@/oss/components/pages/settings/Vault/Vault"), {
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

const Triggers = dynamic(() => import("@/oss/components/pages/settings/Triggers/Triggers"), {
    ssr: false,
})

const Organization = dynamic(() => import("@/oss/components/pages/settings/Organization"), {
    ssr: false,
})

const DeleteAccount = dynamic(
    () => import("@/oss/components/pages/settings/Account/DeleteAccount"),
    {ssr: false},
)

const Webhooks = dynamic(() => import("@/oss/components/pages/settings/Webhooks/Webhooks"), {
    ssr: false,
})

interface SettingsProps {
    AuditLogComponent?: React.ComponentType
}

export const Settings: React.FC<SettingsProps> = ({AuditLogComponent}) => {
    const [tabQuery] = useQueryParam("tab", undefined, "replace")
    const settingsTab = useAtomValue(settingsTabAtom)
    const tab = tabQuery ?? settingsTab ?? DEFAULT_SETTINGS_TAB
    const {selectedOrg} = useOrgData()
    const settingsAccess = useSettingsAccess()
    const resolvedTab = resolveSettingsTab(tab, settingsAccess)
    const resolvedTabLabel = getSettingsTabLabel(resolvedTab, settingsAccess)
    const {project} = useProjectData()
    const {redirectUrl} = useURL()
    const [isOrgIdCopied, setIsOrgIdCopied] = useState(false)
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

    const breadcrumbs = useMemo(() => {
        return {
            settings: {
                label: resolvedTabLabel,
            },
        }
    }, [resolvedTabLabel])

    useBreadcrumbsEffect({breadcrumbs, type: "new", condition: !!tab}, [
        tab,
        resolvedTab,
        resolvedTabLabel,
    ])

    const isDemoOrg = selectedOrg?.flags?.is_demo ?? false

    const {content, title} = useMemo(() => {
        switch (resolvedTab) {
            case "organization":
                return {
                    content: <Organization />,
                    title: (
                        <div className="flex items-center gap-2">
                            <span>{getSettingsTabLabel("organization", settingsAccess)}</span>
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
            case "llms":
                return {content: <Secrets />, title: getSettingsTabLabel("llms", settingsAccess)}
            case "secrets":
                return {content: <Vault />, title: getSettingsTabLabel("secrets", settingsAccess)}
            case "tools":
                return {content: <Tools />, title: getSettingsTabLabel("tools", settingsAccess)}
            case "triggers":
                return {
                    content: <Triggers />,
                    title: getSettingsTabLabel("triggers", settingsAccess),
                }
            case "apiKeys":
                return {content: <APIKeys />, title: getSettingsTabLabel("apiKeys", settingsAccess)}
            case "billing":
                return {
                    content: <Billing />,
                    title: getSettingsTabLabel("billing", settingsAccess),
                }
            case "webhooks":
                return {
                    content: <Webhooks />,
                    title: getSettingsTabLabel("webhooks", settingsAccess),
                }
            case "auditLog":
                return {
                    content: AuditLogComponent ? <AuditLogComponent /> : <WorkspaceManage />,
                    title: getSettingsTabLabel("auditLog", settingsAccess),
                }
            case "projects":
                return {
                    content: <ProjectsSettings />,
                    title: getSettingsTabLabel("projects", settingsAccess),
                }
            case "account":
                return {
                    content: <DeleteAccount />,
                    title: getSettingsTabLabel("account", settingsAccess),
                }
            default:
                return {
                    content: <WorkspaceManage />,
                    title: getSettingsTabLabel("workspace", settingsAccess),
                }
        }
    }, [resolvedTab, isOrgIdCopied, handleCopyOrgId, isDemoOrg, settingsAccess, AuditLogComponent])

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
