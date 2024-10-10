import {useAppId} from "@/hooks/useAppId"
import {useSession} from "@/hooks/useSession"
import {dynamicContext} from "@/lib/helpers/dynamic"
import {isDemo, renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {AppstoreOutlined, DatabaseOutlined, RocketOutlined, GithubFilled} from "@ant-design/icons"
import {useEffect, useState} from "react"
import {
    ChartDonut,
    ChartLineUp,
    Desktop,
    GithubLogo,
    PaperPlane,
    PersonSimpleRun,
    Phone,
    Question,
    Scroll,
    SlackLogo,
    Gear,
    Dot,
} from "@phosphor-icons/react"
import {useAppsData} from "@/contexts/app.context"

export type SidebarConfig = {
    key: string
    title: string
    tooltip?: string
    link?: string
    icon: JSX.Element
    isHidden?: boolean
    isBottom?: boolean
    submenu?: Omit<SidebarConfig, "submenu">[]
    onClick?: () => void
    tag?: string
    isCloudFeature?: boolean
    cloudFeatureTooltip?: string
    divider?: boolean
    header?: boolean
}

export const useSidebarConfig = () => {
    const appId = useAppId()
    const {doesSessionExist} = useSession()
    const {currentApp, recentlyVisitedAppId} = useAppsData()
    const capitalizedAppName = renameVariablesCapitalizeAll(currentApp?.app_name || "")
    const isOss = !isDemo()
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const {selectedOrg} = useOrgData()

    const sidebarConfig: SidebarConfig[] = [
        {
            key: "app-management-link",
            title: "App Management",
            tooltip: "Create new applications or switch between your existing projects.",
            link: "/apps",
            icon: <AppstoreOutlined />,
            divider: true,
        },
        {
            key: `${currentApp?.app_name || ""}_key`,
            title: capitalizedAppName,
            icon: <></>,
            header: true,
        },
        {
            key: "overview-link",
            title: "Overview",
            link: `/apps/${appId || recentlyVisitedAppId}/overview`,
            icon: <Desktop size={16} />,
            isHidden: !appId && !recentlyVisitedAppId,
        },
        {
            key: "app-playground-link",
            title: "Playground",
            tooltip:
                "Experiment with real data and optimize your parameters including prompts, methods, and configuration settings.",
            link: `/apps/${appId || recentlyVisitedAppId}/playground`,
            icon: <RocketOutlined />,
            isHidden: !appId && !recentlyVisitedAppId,
        },
        {
            key: "app-testsets-link",
            title: "Test Sets",
            tooltip: "Create and manage testsets for evaluation purposes.",
            link: `/apps/${appId || recentlyVisitedAppId}/testsets`,
            icon: <DatabaseOutlined />,
            isHidden: !appId && !recentlyVisitedAppId,
        },
        {
            key: "app-evaluations-link",
            title: "Evaluations",
            link: `/apps/${appId || recentlyVisitedAppId}/evaluations`,
            isHidden: !appId && !recentlyVisitedAppId,
            icon: <ChartDonut size={16} />,
        },
        {
            key: "app-observability-link",
            title: "Observability",
            icon: <ChartLineUp size={16} />,
            isHidden: !appId && !recentlyVisitedAppId,
            link: `/apps/${appId || recentlyVisitedAppId}/observability`,
            cloudFeatureTooltip: "Observability available in Cloud/Enterprise editions only",
        },
        {
            key: "invite-teammate-link",
            title: "Invite Teammate",
            link: "/settings?tab=workspace&inviteModal=open",
            icon: <PaperPlane size={16} />,
            isBottom: true,
            isHidden: !doesSessionExist || (true && !selectedOrg),
        },
        {
            key: "settings-link",
            title: "Settings",
            link: "/settings",
            icon: <Gear size={16} />,
            isBottom: true,
            isHidden: !isOss,
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
                },
                {
                    key: "github-issues",
                    title: "GitHub Issues",
                    link: "https://github.com/Agenta-AI/agenta/issues",
                    icon: <GithubLogo size={16} />,
                },
                {
                    key: "github-support",
                    title: "GitHub Support",
                    link: "https://github.com/Agenta-AI/agenta",
                    icon: <GithubFilled size={16} />,
                },
                {
                    key: "slack-connect",
                    title: "Slack connect",
                    link: "https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA",
                    icon: <SlackLogo size={16} />,
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
