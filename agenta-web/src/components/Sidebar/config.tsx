import {useProfileData} from "@/contexts/profile.context"
import {useAppId} from "@/hooks/useAppId"
import {useSession} from "@/hooks/useSession"
import {GenericObject, JSSTheme} from "@/lib/Types"
import {getColorFromStr} from "@/lib/helpers/colors"
import {dynamicContext} from "@/lib/helpers/dynamic"
import {getInitials, isDemo} from "@/lib/helpers/utils"
import {
    ApartmentOutlined,
    ApiOutlined,
    AppstoreOutlined,
    BarChartOutlined,
    CloudUploadOutlined,
    DashboardOutlined,
    DatabaseOutlined,
    FormOutlined,
    LineChartOutlined,
    LogoutOutlined,
    PartitionOutlined,
    PhoneOutlined,
    PlayCircleOutlined,
    ReadOutlined,
    RocketOutlined,
    SettingOutlined,
    SlidersOutlined,
    SwapOutlined,
} from "@ant-design/icons"
import {Avatar} from "antd"
import {useEffect, useState} from "react"
import AlertPopup from "../AlertPopup/AlertPopup"
import Image from "next/image"
import abTesting from "@/media/testing.png"
import singleModel from "@/media/score.png"
import {createUseStyles} from "react-jss"

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
}

export const useSidebarConfig = () => {
    const classes = useStyles()
    const appId = useAppId()
    const {user} = useProfileData()
    const {doesSessionExist, logout} = useSession()
    const isOss = !isDemo()
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const {selectedOrg, orgs, changeSelectedOrg} = useOrgData()

    const sidebarConfig: SidebarConfig[] = [
        {
            key: "app-management-link",
            title: "App Management",
            tooltip: "Create new applications or switch between your existing projects.",
            link: "/apps",
            icon: <AppstoreOutlined />,
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
            icon: <BarChartOutlined />,
            isHidden: !appId,
            submenu: [
                {
                    key: "app-evaluators-link",
                    title: "Evaluators",
                    tooltip:
                        "Select and customize evaluators such as custom code or regex evaluators.",
                    link: `/apps/${appId}/evaluations/new-evaluator`,
                    icon: <SlidersOutlined />,
                },
                {
                    key: "app-evaluations-results-link",
                    title: "Results",
                    tooltip: "Choose your variants and evaluators to start the evaluation process.",
                    link: `/apps/${appId}/evaluations/results`,
                    icon: <PlayCircleOutlined />,
                },
            ],
        },
        {
            key: "app-human-evaluations-link",
            title: "Human Evaluation",
            icon: <FormOutlined />,
            isHidden: !appId,
            submenu: [
                {
                    key: "app-human-ab-testing-link",
                    title: "A/B Evaluation",
                    tooltip:
                        "A/B tests allow you to compare the performance of two different variants manually.",
                    link: `/apps/${appId}/annotations/human_a_b_testing`,
                    icon: (
                        <Image
                            src={abTesting}
                            alt="A/B Evaluation"
                            className={classes.evaluationImg}
                        />
                    ),
                },
                {
                    key: "app-single-model-test-link",
                    title: "Single Model Eval.",
                    tooltip:
                        "Single model test allows you to score the performance of a single LLM app manually.",
                    link: `/apps/${appId}/annotations/single_model_test`,
                    icon: (
                        <Image
                            src={singleModel}
                            alt="Single Model Evaluation"
                            className={classes.evaluationImg}
                        />
                    ),
                },
            ],
        },
        {
            key: "app-observability-link",
            title: "Observability",
            icon: <LineChartOutlined />,
            isHidden: !appId,
            submenu: [
                {
                    key: "app-observability-dashboard-link",
                    title: "Dashboard",
                    tooltip: "Dashboard view of traces and generations",
                    link: `/apps/${appId}/observability`,
                    icon: <DashboardOutlined />,
                },
                {
                    key: "app-observability-traces-link",
                    title: "Traces",
                    tooltip: "Traces and their details",
                    link: `/apps/${appId}/observability/traces`,
                    icon: <PartitionOutlined />,
                },
                {
                    key: "app-observability-generations-link",
                    title: "Generations",
                    tooltip: "Generations and their details",
                    link: `/apps/${appId}/observability/generations`,
                    icon: <SwapOutlined style={{transform: "rotate(90deg)"}} />,
                },
            ],
        },
        {
            key: "app-deployment-link",
            title: "Deployment",
            icon: <CloudUploadOutlined />,
            isHidden: !appId,
            submenu: [
                {
                    key: "app-endpoints-link",
                    title: "Endpoints",
                    tooltip: "Deploy your applications to different environments.",
                    link: `/apps/${appId}/endpoints`,
                    icon: <ApiOutlined />,
                },
            ],
        },
        {
            key: "settings-link",
            title: "Settings",
            link: "/settings",
            icon: <SettingOutlined />,
            isBottom: true,
            isHidden: !doesSessionExist,
        },
        {
            key: "docs-link",
            title: "Docs",
            link: "https://docs.agenta.ai",
            icon: <ReadOutlined />,
            isBottom: true,
        },
        {
            key: "book-onboarding-call-link",
            title: "Book Onboarding Call",
            link: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
            icon: <PhoneOutlined />,
            isBottom: true,
        },
        {
            key: "orgs-link",
            title: selectedOrg?.name || "",
            icon: <ApartmentOutlined />,
            isHidden: !isOss && !selectedOrg,
            submenu: (orgs || []).map((org: GenericObject) => ({
                key: `orgs-${org.id}-link`,
                title: org.name,
                onClick: () => {
                    changeSelectedOrg?.(org.id)
                },
                icon: (
                    <Avatar
                        size="small"
                        style={{
                            backgroundColor: getColorFromStr(org.id),
                            color: "#fff",
                        }}
                    >
                        {getInitials(org.name)}
                    </Avatar>
                ),
            })),
            isBottom: true,
        },
        {
            key: "logout-link",
            title: "Logout",
            icon: <LogoutOutlined />,
            isBottom: true,
            isHidden: !isOss && !user?.username,
            onClick: () => {
                AlertPopup({
                    title: "Logout",
                    message: "Are you sure you want to logout?",
                    onOk: logout,
                })
            },
        },
    ]

    return sidebarConfig
}
