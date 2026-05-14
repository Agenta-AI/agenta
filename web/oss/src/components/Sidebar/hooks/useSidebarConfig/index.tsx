import {AppstoreOutlined, GithubFilled} from "@ant-design/icons"
import {
    ChartLineUpIcon,
    DatabaseIcon,
    DesktopIcon,
    FlaskIcon,
    PaperPlaneIcon,
    PhoneIcon,
    QuestionIcon,
    ScrollIcon,
    SlackLogoIcon,
    GearIcon,
    TreeViewIcon,
    LightningIcon,
    RocketIcon,
    ChatCircleIcon,
    GavelIcon,
    HouseIcon,
    RocketLaunchIcon,
    ListChecksIcon,
} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {useCrispChat} from "@/oss/hooks/useCrispChat"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {isDemo} from "@/oss/lib/helpers/utils"
import {openWidgetAtom} from "@/oss/lib/onboarding"
import {useAppsData} from "@/oss/state/app"
import {useAppState} from "@/oss/state/appState"
import {useOrgData} from "@/oss/state/org"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

import {SidebarConfig} from "../../types"

export const useSidebarConfig = () => {
    const {doesSessionExist} = useSession()
    const {currentApp, recentlyVisitedAppId} = useAppsData()
    const {appId: routedAppId, routeLayer} = useAppState()
    const {selectedOrg} = useOrgData()
    const {canInviteMembers} = useWorkspacePermissions()
    const {toggle, isVisible, isCrispEnabled} = useCrispChat()
    const {projectURL, baseAppURL, appURL, recentlyVisitedAppURL} = useURL()
    const openWidget = useSetAtom(openWidgetAtom)
    const hasProjectURL = Boolean(projectURL)
    const hasAppContext =
        routeLayer === "app" && Boolean(routedAppId || appURL || recentlyVisitedAppURL)

    // Phase 4: when the current workflow is an evaluator, DISABLE (not hide)
    // the app-section items that don't apply to evaluators (overview,
    // evaluations). Items stay visible but greyed out so the user understands
    // they exist — they just aren't applicable for this workflow type.
    // Endpoints and deployments aren't in the sidebar today, so no extra
    // gating needed for those.
    const workflowCtx = useAtomValue(currentWorkflowContextAtom)
    const isCurrentWorkflowEvaluator = workflowCtx.workflowKind === "evaluator"

    const sidebarConfig: SidebarConfig[] = [
        {
            key: "app-management-link",
            title: "Home",
            link: baseAppURL,
            icon: <HouseIcon size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-playground-link",
            title: "Playground",
            link: `${projectURL}/playground`,
            icon: <RocketIcon size={14} />,
            isHidden: true,
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
            icon: <DatabaseIcon size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-evaluators-link",
            title: "Evaluators",
            link: `${projectURL}/evaluators`,
            // isHidden: !isDemo(),
            icon: <GavelIcon size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-evaluations-link",
            title: "Evaluations",
            link: `${projectURL}/evaluations`,
            // isHidden: !isDemo(),
            icon: <FlaskIcon size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "project-annotation-queues-link",
            title: "Annotation Queues",
            link: `${projectURL}/annotations`,
            icon: <ListChecksIcon size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "app-observability-link",
            title: "Observability",
            link: `${projectURL}/observability`,
            icon: <ChartLineUpIcon size={14} />,
            disabled: !hasProjectURL,
        },
        {
            key: "overview-link",
            title: "Overview",
            link: `${appURL || recentlyVisitedAppURL}/overview`,
            icon: <DesktopIcon size={14} />,
            isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            // Disabled (not hidden) for evaluator workflows so the user still
            // sees these surfaces exist — just not applicable here.
            disabled: !hasProjectURL || isCurrentWorkflowEvaluator,
        },
        {
            key: "app-playground-link",
            title: "Playground",
            link: `${appURL || recentlyVisitedAppURL}/playground`,
            icon: <RocketIcon size={14} />,
            isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            disabled: !hasProjectURL,
        },
        {
            key: "app-variants-link",
            title: "Registry",
            link: `${appURL || recentlyVisitedAppURL}/variants`,
            isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            icon: <LightningIcon size={14} />,
            disabled: !hasProjectURL,
            dataTour: "registry-nav",
        },
        {
            key: "app-evaluations-link",
            title: "Evaluations",
            link: `${appURL || recentlyVisitedAppURL}/evaluations`,
            isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            icon: <FlaskIcon size={14} />,
            // Disabled (not hidden) for evaluator workflows.
            disabled: !hasProjectURL || isCurrentWorkflowEvaluator,
            dataTour: "evaluations-nav",
        },
        {
            key: "app-traces-link",
            title: "Observability",
            icon: <TreeViewIcon size={14} />,
            isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
            isAppSection: true,
            link: `${appURL || recentlyVisitedAppURL}/traces`,
            disabled: !hasProjectURL,
        },
        {
            key: "settings-link",
            title: "Settings",
            link: `${projectURL}/settings`,
            icon: <GearIcon size={14} />,
            isBottom: true,
            tooltip: "Settings",
            disabled: !hasProjectURL,
        },
        {
            key: "invite-teammate-link",
            title: "Invite Teammate",
            link: `${projectURL}/settings?tab=workspace&inviteModal=open`,
            icon: <PaperPlaneIcon size={14} />,
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
                    <RocketLaunchIcon size={16} />
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
            icon: <ChatCircleIcon size={14} />,
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
            icon: <QuestionIcon size={14} />,
            isBottom: true,
            submenu: [
                {
                    key: "docs",
                    title: "Documentation",
                    link: "https://agenta.ai/docs/",
                    icon: <ScrollIcon size={14} />,
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
                    icon: <SlackLogoIcon size={14} />,
                    divider: true,
                },
                {
                    key: "book-call",
                    title: "Book a call",
                    link: "https://cal.com/mahmoud-mabrouk-ogzgey/demo",
                    icon: <PhoneIcon size={14} />,
                },
            ],
        },
    ]

    return sidebarConfig
}
