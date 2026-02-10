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
    RocketLaunch,
} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {useCrispChat} from "@/oss/hooks/useCrispChat"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {isDemo} from "@/oss/lib/helpers/utils"
import {openWidgetAtom} from "@/oss/lib/onboarding"
import {useAppsData} from "@/oss/state/app"
import {useOrgData} from "@/oss/state/org"

import {SidebarConfig} from "../../types"

export const useSidebarConfig = () => {
    const {doesSessionExist} = useSession()
    const {currentApp, recentlyVisitedAppId} = useAppsData()
    const {selectedOrg} = useOrgData()
    const {canInviteMembers} = useWorkspacePermissions()
    const {toggle, isVisible, isCrispEnabled} = useCrispChat()
    const {projectURL, baseAppURL, appURL, recentlyVisitedAppURL} = useURL()
    const openWidget = useSetAtom(openWidgetAtom)
    const hasProjectURL = Boolean(projectURL)

    const sidebarConfig: SidebarConfig[] = [
        {
            key: "app-management-link",
            title: "Home",
            link: baseAppURL,
            icon: <HouseIcon size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-prompts-link",
            title: "Prompts",
            link: `${projectURL}/prompts`,
            icon: <AppstoreOutlined style={{fontSize: 14}} />,
            disabled: !hasProjectURL,
        },
        {
            key: "app-testsets-link",
            title: "Test sets",
            link: `${projectURL}/testsets`,
            icon: <DatabaseOutlined style={{fontSize: 14}} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-evaluators-link",
            title: "Evaluators",
            link: `${projectURL}/evaluators`,
            // isHidden: !isDemo(),
            icon: <Gauge size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-evaluations-link",
            title: "Evaluations",
            link: `${projectURL}/evaluations`,
            // isHidden: !isDemo(),
            icon: <ChartDonut size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "app-observability-link",
            title: "Observability",
            link: `${projectURL}/observability`,
            icon: <ChartLineUp size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "overview-link",
            title: "Overview",
            link: `${appURL || recentlyVisitedAppURL}/overview`,
            icon: <Desktop size={14} />,
            isHidden: !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            disabled: !hasProjectURL,
        },
        {
            key: "app-playground-link",
            title: "Playground",
            link: `${appURL || recentlyVisitedAppURL}/playground`,
            icon: <Rocket size={14} />,
            isHidden: !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            disabled: !hasProjectURL,
        },
        {
            key: "app-variants-link",
            title: "Registry",
            link: `${appURL || recentlyVisitedAppURL}/variants`,
            isHidden: !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            icon: <Lightning size={14} />,
            disabled: !hasProjectURL,
            dataTour: "registry-nav",
        },
        {
            key: "app-evaluations-link",
            title: "Evaluations",
            link: `${appURL || recentlyVisitedAppURL}/evaluations`,
            isHidden: !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            icon: <ChartDonut size={14} />,
            disabled: !hasProjectURL,
            dataTour: "evaluations-nav",
        },
        {
            key: "app-traces-link",
            title: "Observability",
            icon: <TreeView size={14} />,
            isHidden: !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            link: `${appURL || recentlyVisitedAppURL}/traces`,
            disabled: !hasProjectURL,
        },
        {
            key: "settings-link",
            title: "Settings",
            link: `${projectURL}/settings`,
            icon: <Gear size={14} />,
            isBottom: true,
            tooltip: "Settings",
            disabled: !hasProjectURL,
        },
        {
            key: "invite-teammate-link",
            title: "Invite Teammate",
            link: `${projectURL}/settings?tab=workspace&inviteModal=open`,
            icon: <PaperPlane size={14} />,
            isBottom: true,
            tooltip: "Invite Teammate",
            isHidden: !doesSessionExist || !selectedOrg || !canInviteMembers,
            disabled: !hasProjectURL,
        },
        {
            key: "get-started-guide-link",
            title: "Get Started Guide",
            icon: (
                <span id="sidebar-get-started-guide">
                    <RocketLaunch size={16} />
                </span>
            ),
            isBottom: true,
            tooltip: "Open the onboarding guide",
            isHidden: !doesSessionExist,
            onClick: (e) => {
                e.preventDefault()
                openWidget()
            },
        },
        {
            key: "support-chat-link",
            title: `Live Chat Support: ${isVisible ? "On" : "Off"}`,
            icon: <ChatCircle size={14} />,
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
            icon: <Question size={14} />,
            isBottom: true,
            submenu: [
                {
                    key: "docs",
                    title: "Documentation",
                    link: "https://agenta.ai/docs/",
                    icon: <Scroll size={14} />,
                    divider: true,
                },
                {
                    key: "github-support",
                    title: "GitHub Support",
                    link: "https://github.com/Agenta-AI/agenta/issues",
                    icon: <GithubFilled style={{fontSize: 14}} />,
                },
                {
                    key: "slack-connect",
                    title: "Slack Support",
                    link: "https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw",
                    icon: <SlackLogo size={14} />,
                    divider: true,
                },
                {
                    key: "book-call",
                    title: "Book a call",
                    link: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
                    icon: <Phone size={14} />,
                },
            ],
        },
    ]

    return sidebarConfig
}
