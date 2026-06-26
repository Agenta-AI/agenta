import {useCallback, useMemo} from "react"

import {GithubFilled} from "@ant-design/icons"
import {
    ChartLineUpIcon,
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
import {useSetAtom} from "jotai"

import {getEntityKindIcon} from "@/oss/components/References"
import {useCrispChat} from "@/oss/hooks/useCrispChat"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {isDemo} from "@/oss/lib/helpers/utils"
import {openWidgetAtom} from "@/oss/lib/onboarding"
import {useAppsData} from "@/oss/state/app"
import {useAppState} from "@/oss/state/appState"
import {useOrgData} from "@/oss/state/org"

import {PROMPTS_SIDEBAR_KEY} from "../../dynamic/registry"
import {
    injectDynamicChildren,
    useSidebarDynamicChildren,
} from "../../dynamic/useSidebarDynamicChildren"
import {SidebarConfig} from "../../engine/types"

export interface MainSidebarItems {
    projectItems: SidebarConfig[]
    appItems: SidebarConfig[]
    bottomItems: SidebarConfig[]
}

export const useSidebarConfig = (): MainSidebarItems => {
    const {doesSessionExist} = useSession()
    const {currentApp, recentlyVisitedAppId} = useAppsData()
    const {appId: routedAppId, routeLayer} = useAppState()
    const {selectedOrg} = useOrgData()
    const {canInviteMembers} = useWorkspacePermissions()
    const {toggle, isVisible, isCrispEnabled} = useCrispChat()
    const {projectURL, baseAppURL, appURL, recentlyVisitedAppURL} = useURL()
    const openWidget = useSetAtom(openWidgetAtom)
    const dynamicChildren = useSidebarDynamicChildren()
    const hasProjectURL = Boolean(projectURL)
    const hasAppContext =
        routeLayer === "app" && Boolean(routedAppId || appURL || recentlyVisitedAppURL)

    const handleOpenWidget = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault()
            openWidget()
        },
        [openWidget],
    )

    const handleToggleSupport = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault()
            toggle()
        },
        [toggle],
    )

    const projectItems = useMemo<SidebarConfig[]>(
        () => [
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
                key: PROMPTS_SIDEBAR_KEY,
                title: "Prompts",
                link: `${projectURL}/prompts`,
                icon: getEntityKindIcon("app"),
                disabled: !hasProjectURL,
            },
            {
                key: "evaluation-group",
                title: "Evaluation",
                icon: <FlaskIcon size={14} />,
                disabled: !hasProjectURL,
                submenu: [
                    {
                        key: "app-testsets-link",
                        title: "Test sets",
                        link: `${projectURL}/testsets`,
                        icon: getEntityKindIcon("testset"),
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
                ],
            },
            {
                key: "app-observability-link",
                title: "Observability",
                link: `${projectURL}/observability`,
                icon: <ChartLineUpIcon size={14} />,
                disabled: !hasProjectURL,
            },
        ],
        [baseAppURL, hasProjectURL, projectURL],
    )

    const appItems = useMemo<SidebarConfig[]>(
        () => [
            {
                key: "overview-link",
                title: "Overview",
                link: `${appURL || recentlyVisitedAppURL}/overview`,
                icon: <DesktopIcon size={14} />,
                isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
                // Enabled for evaluators too — Overview surfaces the workflow's
                // details, variants, and the evaluation runs that evaluated it
                // (scoped by the workflow id as the `application` reference).
                disabled: !hasProjectURL,
            },
            {
                key: "app-playground-link",
                title: "Playground",
                link: `${appURL || recentlyVisitedAppURL}/playground`,
                icon: <RocketIcon size={14} />,
                isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
                disabled: !hasProjectURL,
            },
            {
                key: "app-variants-link",
                title: "Registry",
                link: `${appURL || recentlyVisitedAppURL}/variants`,
                isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
                icon: <LightningIcon size={14} />,
                disabled: !hasProjectURL,
                dataTour: "registry-nav",
            },
            {
                key: "app-evaluations-link",
                title: "Evaluations",
                link: `${appURL || recentlyVisitedAppURL}/evaluations`,
                isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
                icon: <FlaskIcon size={14} />,
                // Enabled for evaluators too — shows the evaluation runs that
                // evaluated this evaluator (scoped by its id as the `application`
                // reference, same machinery as the app-scoped evaluations page).
                disabled: !hasProjectURL,
                dataTour: "evaluations-nav",
            },
            {
                key: "app-traces-link",
                title: "Observability",
                icon: <TreeViewIcon size={14} />,
                isHidden: !hasAppContext && !currentApp && !recentlyVisitedAppId,
                link: `${appURL || recentlyVisitedAppURL}/traces`,
                disabled: !hasProjectURL,
            },
        ],
        [
            appURL,
            currentApp,
            hasAppContext,
            hasProjectURL,
            recentlyVisitedAppId,
            recentlyVisitedAppURL,
        ],
    )

    const bottomItems = useMemo<SidebarConfig[]>(
        () => [
            {
                key: "settings-link",
                title: "Settings",
                link: `${projectURL}/settings`,
                icon: <GearIcon size={14} />,
                tooltip: "Settings",
                disabled: !hasProjectURL,
            },
            {
                key: "invite-teammate-link",
                title: "Invite Teammate",
                link: `${projectURL}/settings?tab=workspace&inviteModal=open`,
                icon: <PaperPlaneIcon size={14} />,
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
                tooltip: "Open the onboarding guide",
                isHidden: !doesSessionExist,
                onClick: handleOpenWidget,
            },
            {
                key: "support-chat-link",
                title: `Live Chat Support: ${isVisible ? "On" : "Off"}`,
                icon: <ChatCircleIcon size={14} />,
                isHidden: !isDemo() || !isCrispEnabled,
                onClick: handleToggleSupport,
            },
            {
                key: "help-docs-link",
                title: "Help & Docs",
                icon: <QuestionIcon size={14} />,
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
        ],
        [
            canInviteMembers,
            doesSessionExist,
            handleOpenWidget,
            handleToggleSupport,
            hasProjectURL,
            isCrispEnabled,
            isVisible,
            projectURL,
            selectedOrg,
        ],
    )

    const projectItemsWithDynamicChildren = useMemo(
        () => injectDynamicChildren(projectItems, dynamicChildren),
        [projectItems, dynamicChildren],
    )

    return useMemo(
        () => ({
            projectItems: projectItemsWithDynamicChildren,
            appItems,
            bottomItems,
        }),
        [projectItemsWithDynamicChildren, appItems, bottomItems],
    )
}
