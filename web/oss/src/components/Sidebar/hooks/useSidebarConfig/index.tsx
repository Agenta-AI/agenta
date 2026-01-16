import {AppstoreOutlined, DatabaseOutlined, GithubFilled} from "@ant-design/icons"
import {
    ChartDonut,
    ChartLineUp,
    Desktop,
    PaperPlane,
    Phone,
    Question,
    Scroll,
    SlackLogo,
    Gear,
    TreeView,
    Lightning,
    Rocket,
    ChatCircle,
    Gauge,
    HouseIcon,
} from "@phosphor-icons/react"

import {useCrispChat} from "@/oss/hooks/useCrispChat"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useAppsData} from "@/oss/state/app"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useWorkspaceMembers} from "@/oss/state/workspace"

import {SidebarConfig} from "../../types"

export const useSidebarConfig = () => {
    const {doesSessionExist} = useSession()
    const {currentApp, recentlyVisitedAppId} = useAppsData()
    const {selectedOrg} = useOrgData()
    const {user: signedInUser} = useProfileData()
    const {filteredMembers} = useWorkspaceMembers()
    const {hasRBAC} = useEntitlements()
    const {toggle, isVisible, isCrispEnabled} = useCrispChat()
    const {projectURL, baseAppURL, appURL, recentlyVisitedAppURL} = useURL()

    const hasProjectURL = Boolean(projectURL)

    // Check if current user can invite members (owner or workspace_admin only)
    const canInviteMembers = (() => {
        if (!isEE()) return true // OSS mode - allow all
        if (!hasRBAC) return true // No RBAC - allow all

        // Check if user is organization owner
        if (selectedOrg?.owner_id && signedInUser?.id === selectedOrg.owner_id) {
            return true
        }

        const currentMember = filteredMembers.find(
            (member) => member.user?.id === signedInUser?.id || member.user?.email === signedInUser?.email
        )

        if (!currentMember) return false

        const allowedRoles = ["owner", "workspace_admin"]
        return currentMember.roles?.some((role) => allowedRoles.includes(role.role_name))
    })()

    const sidebarConfig: SidebarConfig[] = [
        {
            key: "app-management-link",
            title: "Home",
            link: baseAppURL,
            icon: <HouseIcon size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-prompts-link",
            title: "Prompts",
            link: `${projectURL}/prompts`,
            icon: <AppstoreOutlined size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: "app-testsets-link",
            title: "Testsets",
            link: `${projectURL}/testsets`,
            icon: <DatabaseOutlined size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-evaluators-link",
            title: "Evaluators",
            link: `${projectURL}/evaluators`,
            // isHidden: !isDemo(),
            icon: <Gauge size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-evaluations-link",
            title: "Evaluations",
            link: `${projectURL}/evaluations`,
            // isHidden: !isDemo(),
            icon: <ChartDonut size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: "app-observability-link",
            title: "Observability",
            link: `${projectURL}/observability`,
            icon: <ChartLineUp size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: `${currentApp?.app_name || ""}_key`,
            title: currentApp?.app_name || "",
            icon: <></>,
            header: true,
        },
        {
            key: "overview-link",
            title: "Overview",
            link: `${appURL || recentlyVisitedAppURL}/overview`,
            icon: <Desktop size={16} />,
            isHidden: !currentApp && !recentlyVisitedAppId,
            disabled: !hasProjectURL,
        },
        {
            key: "app-playground-link",
            title: "Playground",
            link: `${appURL || recentlyVisitedAppURL}/playground`,
            icon: <Rocket size={16} />,
            isHidden: !currentApp && !recentlyVisitedAppId,
            disabled: !hasProjectURL,
        },
        {
            key: "app-variants-link",
            title: "Registry",
            link: `${appURL || recentlyVisitedAppURL}/variants`,
            isHidden: !currentApp && !recentlyVisitedAppId,
            icon: <Lightning size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: "app-evaluations-link",
            title: "Evaluations",
            link: `${appURL || recentlyVisitedAppURL}/evaluations`,
            isHidden: !currentApp && !recentlyVisitedAppId,
            icon: <ChartDonut size={16} />,
            disabled: !hasProjectURL,
        },
        {
            key: "app-traces-link",
            title: "Observability",
            icon: <TreeView size={16} />,
            isHidden: !currentApp && !recentlyVisitedAppId,
            link: `${appURL || recentlyVisitedAppURL}/traces`,
            disabled: !hasProjectURL,
        },
        {
            key: "settings-link",
            title: "Settings",
            link: `${projectURL}/settings`,
            icon: <Gear size={16} />,
            isBottom: true,
            tooltip: "Settings",
            disabled: !hasProjectURL,
        },
        {
            key: "invite-teammate-link",
            title: "Invite Teammate",
            link: `${projectURL}/settings?tab=workspace&inviteModal=open`,
            icon: <PaperPlane size={16} />,
            isBottom: true,
            tooltip: "Invite Teammate",
            isHidden: !doesSessionExist || !selectedOrg || !canInviteMembers,
            disabled: !hasProjectURL,
        },
        {
            key: "support-chat-link",
            title: `Live Chat Support: ${isVisible ? "On" : "Off"}`,
            icon: <ChatCircle size={16} />,
            isBottom: true,
            isHidden: !isDemo() || !isCrispEnabled,
            onClick: (e) => {
                e.preventDefault()
                toggle()
            },
        },
        {
            key: "help-docs-link",
            title: "Help & Docs",
            icon: <Question size={16} />,
            isBottom: true,
            submenu: [
                {
                    key: "docs",
                    title: "Documentation",
                    link: "https://agenta.ai/docs/",
                    icon: <Scroll size={16} />,
                    divider: true,
                },
                {
                    key: "github-support",
                    title: "GitHub Support",
                    link: "https://github.com/Agenta-AI/agenta/issues",
                    icon: <GithubFilled size={16} />,
                },
                {
                    key: "slack-connect",
                    title: "Slack Support",
                    link: "https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw",
                    icon: <SlackLogo size={16} />,
                    divider: true,
                },
                {
                    key: "book-call",
                    title: "Book a call",
                    link: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
                    icon: <Phone size={16} />,
                },
            ],
        },
    ]

    return sidebarConfig
}
