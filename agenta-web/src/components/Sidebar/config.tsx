import {useAppId} from "@/hooks/useAppId"
import {useSession} from "@/hooks/useSession"
import {JSSTheme} from "@/lib/Types"
import {dynamicContext} from "@/lib/helpers/dynamic"
import {isDemo, renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {
    ApiOutlined,
    AppstoreOutlined,
    DashboardOutlined,
    DatabaseOutlined,
    PartitionOutlined,
    PlayCircleOutlined,
    RocketOutlined,
    SlidersOutlined,
    SwapOutlined,
    GithubFilled,
} from "@ant-design/icons"
import {useEffect, useState} from "react"
import Image from "next/image"
import abTesting from "@/media/testing.png"
import singleModel from "@/media/score.png"
import {createUseStyles} from "react-jss"
import {
    ChartDonut,
    ChartLineUp,
    CloudArrowUp,
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

const useStyles = createUseStyles((theme: JSSTheme) => ({
    evaluationImg: {
        width: 20,
        height: 20,
        filter: theme.isDark ? "invert(1)" : "none",
    },
}))

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
    const classes = useStyles()
    const appId = useAppId()
    const {doesSessionExist} = useSession()
    const {currentApp} = useAppsData()
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
            link: `/apps/${appId}/overview`,
            icon: <Desktop size={16} />,
            isHidden: !appId,
        },
        {
            key: "app-playground-link",
            title: "Playground",
            tooltip:
                "Experiment with real data and optimize your parameters including prompts, methods, and configuration settings.",
            link: `/apps/${appId}/playground`,
            icon: <RocketOutlined />,
            isHidden: !appId,
        },
        {
            key: "app-testsets-link",
            title: "Test Sets",
            tooltip: "Create and manage testsets for evaluation purposes.",
            link: `/apps/${appId}/testsets`,
            icon: <DatabaseOutlined />,
            isHidden: !appId,
        },
        {
            key: "app-auto-evaluations-link",
            title: "Automatic Evaluation",
            icon: <ChartDonut size={16} />,
            isHidden: !appId,
            submenu: [
                {
                    key: "app-evaluators-link",
                    title: "Evaluators",
                    tooltip:
                        "Select and customize evaluators such as custom code or regex evaluators.",
                    link: `/apps/${appId}/evaluations/new-evaluator`,
                    icon: <Dot size={16} />,
                },
                {
                    key: "app-evaluations-results-link",
                    title: "Results",
                    tooltip: "Choose your variants and evaluators to start the evaluation process.",
                    link: `/apps/${appId}/evaluations/results`,
                    icon: <Dot size={16} />,
                },
            ],
        },
        {
            key: "app-human-evaluations-link",
            title: "Human Evaluation",
            icon: <PersonSimpleRun size={16} />,
            isHidden: !appId,
            submenu: [
                {
                    key: "app-human-ab-testing-link",
                    title: "A/B Evaluation",
                    tooltip:
                        "A/B tests allow you to compare the performance of two different variants manually.",
                    link: `/apps/${appId}/annotations/human_a_b_testing`,
                    icon: <Dot size={16} />,
                },
                {
                    key: "app-single-model-test-link",
                    title: "Single Model Eval.",
                    tooltip:
                        "Single model test allows you to score the performance of a single LLM app manually.",
                    link: `/apps/${appId}/annotations/single_model_test`,
                    icon: <Dot size={16} />,
                },
            ],
        },
        {
            key: "app-observability-link",
            title: "Observability",
            icon: <ChartLineUp size={16} />,
            isHidden: !appId,
            isCloudFeature: true && isOss,
            cloudFeatureTooltip: "Observability available in Cloud/Enterprise editions only",
            tag: "beta",
            submenu: [
                {
                    key: "app-observability-dashboard-link",
                    title: "Dashboard",
                    tooltip: "Dashboard view of traces and generations",
                    link: `/apps/${appId}/observability`,
                    icon: <Dot size={16} />,
                },
                {
                    key: "app-observability-traces-link",
                    title: "Traces",
                    tooltip: "Traces and their details",
                    link: `/apps/${appId}/observability/traces`,
                    icon: <Dot size={16} />,
                },
                {
                    key: "app-observability-generations-link",
                    title: "Generations",
                    tooltip: "Generations and their details",
                    link: `/apps/${appId}/observability/generations`,
                    icon: <Dot size={16} />,
                },
            ],
        },
        {
            key: "app-deployment-link",
            title: "Deployment",
            icon: <CloudArrowUp size={16} />,
            isHidden: !appId,
            submenu: [
                {
                    key: "app-endpoints-link",
                    title: "Endpoints",
                    tooltip: "Deploy your applications to different environments.",
                    link: `/apps/${appId}/endpoints`,
                    icon: <Dot size={16} />,
                },
            ],
        },
        {
            key: "invite-teammate-link",
            title: "Invite Teammate",
            link: "/settings?tab=workspace&inviteModal=true",
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
