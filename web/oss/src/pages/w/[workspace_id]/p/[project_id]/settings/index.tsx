import {useCallback, useEffect, useMemo} from "react"

import {
    getSettingsTabVariant,
    DEFAULT_SETTINGS_TAB,
    getSettingsTabDescription,
    getSettingsTabDocs,
    getSettingsTabLabel,
    resolveSettingsTab,
} from "@agenta/settings"
import {SettingsPageShell} from "@agenta/settings-ui"
import {Tag} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useSettingsAccess} from "@/oss/components/pages/settings/hooks/useSettingsAccess"
import PageTitle from "@/oss/components/PageTitle"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {useOrgData} from "@/oss/state/org"
import {useProjectData} from "@/oss/state/project"
import {settingsTabAtom} from "@/oss/state/settings"

const AIProviders = dynamic(
    () => import("@/oss/components/pages/settings/AIProviders/AIProviders"),
    {ssr: false},
)
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

const Channels = dynamic(() => import("@/oss/components/pages/settings/Channels/Channels"), {
    ssr: false,
})

const Organization = dynamic(() => import("@/oss/components/pages/settings/Organization"), {
    ssr: false,
})

const OrganizationGeneral = dynamic(
    () => import("@/oss/components/pages/settings/Organization/General"),
    {ssr: false},
)

const DeleteAccount = dynamic(
    () => import("@/oss/components/pages/settings/Account/DeleteAccount"),
    {ssr: false},
)

const Webhooks = dynamic(() => import("@/oss/components/pages/settings/Webhooks/Webhooks"), {
    ssr: false,
})

const Preferences = dynamic(
    () => import("@/oss/components/pages/settings/Preferences/Preferences"),
    {ssr: false},
)

interface SettingsProps {
    AuditLogComponent?: React.ComponentType
}

/** Tabs that render a form rather than a table, so they cap at 640 instead of 1120. */

/**
 * Tabs whose table is wider than the 1120 cap every other table tab gets — the Audit Log
 * carries a timestamp, a dotted event type and a full UUID on one row.
 */

export const Settings: React.FC<SettingsProps> = ({AuditLogComponent}) => {
    const [tabQuery] = useQueryParam("tab", undefined, "replace")
    const settingsTab = useAtomValue(settingsTabAtom)
    const tab = tabQuery ?? settingsTab ?? DEFAULT_SETTINGS_TAB
    const {selectedOrg} = useOrgData()
    const settingsAccess = useSettingsAccess()
    const resolvedTab = resolveSettingsTab(tab, settingsAccess)
    const {project} = useProjectData()
    const {redirectUrl} = useURL()
    const settingsKey = `${selectedOrg?.id ?? "org"}:${project?.project_id ?? "project"}`

    useEffect(() => {
        if (project?.is_demo) {
            redirectUrl()
        }
    }, [project, redirectUrl])

    const isDemoOrg = selectedOrg?.flags?.is_demo ?? false

    // The org ID has its own column now; the title only carries the demo marker.
    const buildOrganizationTitle = useCallback(
        (label: string) => (
            <div className="flex items-center gap-2">
                <span>{label}</span>
                {isDemoOrg && <Tag className="bg-[var(--ag-c-0517290F)] m-0 font-normal">demo</Tag>}
            </div>
        ),
        [isDemoOrg],
    )

    const {content, title} = useMemo(() => {
        switch (resolvedTab) {
            case "organizationGeneral":
                return {
                    content: <OrganizationGeneral />,
                    title: buildOrganizationTitle(
                        getSettingsTabLabel("organizationGeneral", settingsAccess),
                    ),
                }
            case "organization":
                return {
                    content: <Organization />,
                    title: buildOrganizationTitle(
                        getSettingsTabLabel("organization", settingsAccess),
                    ),
                }
            case "llms":
                return {
                    content: <AIProviders />,
                    title: getSettingsTabLabel("llms", settingsAccess),
                }
            case "secrets":
                return {content: <Vault />, title: getSettingsTabLabel("secrets", settingsAccess)}
            case "tools":
                return {content: <Tools />, title: getSettingsTabLabel("tools", settingsAccess)}
            case "triggers":
                return {
                    content: <Triggers />,
                    title: getSettingsTabLabel("triggers", settingsAccess),
                }
            case "channels":
                return {
                    content: <Channels />,
                    title: getSettingsTabLabel("channels", settingsAccess),
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
            case "preferences":
                return {
                    content: <Preferences />,
                    title: getSettingsTabLabel("preferences", settingsAccess),
                }
            default:
                return {
                    content: <WorkspaceManage />,
                    title: getSettingsTabLabel("workspace", settingsAccess),
                }
        }
    }, [resolvedTab, buildOrganizationTitle, settingsAccess, AuditLogComponent])

    return (
        <>
            <PageTitle title="Settings" />
            <SettingsPageShell
                key={settingsKey}
                title={title}
                description={getSettingsTabDescription(resolvedTab, settingsAccess)}
                docs={getSettingsTabDocs(resolvedTab)}
                variant={getSettingsTabVariant(resolvedTab)}
            >
                {content}
            </SettingsPageShell>
        </>
    )
}

export default () => <Settings />
