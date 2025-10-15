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
    CloudArrowUp,
    ChatCircle,
    Gauge,
} from "@phosphor-icons/react"

import {useAppId} from "@/oss/hooks/useAppId"
import {useCrispChat} from "@/oss/hooks/useCrispChat"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useAppsData} from "@/oss/state/app"
import {useOrgData} from "@/oss/state/org"

import {SidebarConfig} from "../../types"

export const useSidebarConfig = () => {
    const appId = useAppId()
    const {doesSessionExist} = useSession()
    const {currentApp, recentlyVisitedAppId} = useAppsData()
    const {selectedOrg} = useOrgData()
    const {toggle, isVisible, isCrispEnabled} = useCrispChat()
    const {projectURL, baseAppURL, appURL, recentlyVisitedAppURL} = useURL()
    const sidebarConfig: SidebarConfig[] = [
        {
            key: "app-management-link",
            title: "App Management",
            link: baseAppURL,
            icon: <AppstoreOutlined size={16} />,
        },
        {
            key: "app-testsets-link",
            title: "Test Sets",
            link: `${projectURL}/testsets`,
            icon: <DatabaseOutlined size={16} />,
        },
        {
            key: "app-observability-link",
            title: "Observability",
            link: `${projectURL}/observability`,
            icon: <ChartLineUp size={16} />,
        },
        {
            key: "project-evaluators-link",
            title: "Evaluators",
            link: `${projectURL}/evaluators`,
            icon: <Gauge size={16} />,
        },
        {
            key: "project-evaluations-link",
            title: "Evaluations",
            link: `${projectURL}/evaluations`,
            isHidden: !isDemo(),
            icon: <ChartDonut size={16} />,
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
            isHidden: !appId && !recentlyVisitedAppId,
        },
        {
            key: "app-playground-link",
            title: "Playground",
            link: `${appURL || recentlyVisitedAppURL}/playground`,
            icon: <Rocket size={16} />,
            isHidden: !appId && !recentlyVisitedAppId,
        },
        {
            key: "app-variants-link",
            title: "Registry",
            link: `${appURL || recentlyVisitedAppURL}/variants`,
            isHidden: !appId && !recentlyVisitedAppId,
            icon: <Lightning size={16} />,
        },
        {
            key: "app-evaluations-link",
            title: "Evaluations",
            link: `${appURL || recentlyVisitedAppURL}/evaluations`,
            isHidden: (!appId && !recentlyVisitedAppId) || !isDemo(),
            icon: <ChartDonut size={16} />,
        },
        {
            key: "app-traces-link",
            title: "Traces",
            icon: <TreeView size={16} />,
            isHidden: !appId && !recentlyVisitedAppId,
            link: `${appURL || recentlyVisitedAppURL}/traces`,
        },
        {
            key: "app-deployments-link",
            title: "Deployments",
            link: `${appURL || recentlyVisitedAppURL}/deployments`,
            isHidden: !appId && !recentlyVisitedAppId,
            icon: <CloudArrowUp size={16} />,
        },
        {
            key: "settings-link",
            title: "Settings",
            link: `${projectURL}/settings`,
            icon: <Gear size={16} />,
            isBottom: true,
            tooltip: "Settings",
        },
        {
            key: "invite-teammate-link",
            title: "Invite Teammate",
            link: `${projectURL}/settings?tab=workspace&inviteModal=open`,
            icon: <PaperPlane size={16} />,
            isBottom: true,
            tooltip: "Invite Teammate",
            isHidden: !doesSessionExist || !selectedOrg,
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
                    link: "https://docs.agenta.ai/",
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
