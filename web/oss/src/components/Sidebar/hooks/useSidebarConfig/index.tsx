import {useMemo} from "react"

import {
    ChartLineUpIcon,
    DesktopIcon,
    FlaskIcon,
    TreeViewIcon,
    LightningIcon,
    RocketIcon,
    GavelIcon,
    HouseIcon,
    ListChecksIcon,
    RobotIcon,
} from "@phosphor-icons/react"

import {getEntityKindIcon} from "@/oss/components/References"
import useURL from "@/oss/hooks/useURL"
import {useCurrentAppLite} from "@/oss/state/app"
import {useAppState} from "@/oss/state/appState"

import {
    AGENTS_SIDEBAR_KEY,
    EVALUATORS_SIDEBAR_KEY,
    PROMPTS_SIDEBAR_KEY,
    TESTSETS_SIDEBAR_KEY,
} from "../../dynamic/registry"
import {
    injectDynamicChildren,
    useSidebarDynamicChildren,
} from "../../dynamic/useSidebarDynamicChildren"
import {SidebarConfig} from "../../engine/types"

export interface MainSidebarItems {
    projectItems: SidebarConfig[]
    appItems: SidebarConfig[]
}

export const useSidebarConfig = (): MainSidebarItems => {
    const {currentApp, recentlyVisitedAppId} = useCurrentAppLite()
    const {appId: routedAppId, routeLayer} = useAppState()
    const {projectURL, baseAppURL, appURL, recentlyVisitedAppURL} = useURL()
    const dynamicChildren = useSidebarDynamicChildren()
    const hasProjectURL = Boolean(projectURL)
    const hasAppContext =
        routeLayer === "app" && Boolean(routedAppId || appURL || recentlyVisitedAppURL)

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
                key: AGENTS_SIDEBAR_KEY,
                title: "Agents",
                link: `${projectURL}/agents`,
                icon: <RobotIcon size={14} />,
                disabled: !hasProjectURL,
            },
            {
                key: "evaluation-group",
                title: "Evaluation",
                icon: <FlaskIcon size={14} />,
                disabled: !hasProjectURL,
                submenu: [
                    {
                        key: TESTSETS_SIDEBAR_KEY,
                        title: "Test sets",
                        link: `${projectURL}/testsets`,
                        icon: getEntityKindIcon("testset"),
                        disabled: !hasProjectURL,
                    },
                    {
                        key: EVALUATORS_SIDEBAR_KEY,
                        title: "Evaluators",
                        link: `${projectURL}/evaluators`,
                        // isHidden: !isDemo(),
                        icon: <GavelIcon size={14} />,
                        disabled: !hasProjectURL,
                    },
                    {
                        key: "project-evaluations-link",
                        title: "Evaluation runs",
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

    const appItems = useMemo<SidebarConfig[]>(() => {
        const isHidden = !hasAppContext && !currentApp && !recentlyVisitedAppId
        return [
            {
                key: "overview-link",
                title: "Overview",
                link: `${appURL || recentlyVisitedAppURL}/overview`,
                icon: <DesktopIcon size={14} />,
                isHidden,
                // Enabled for evaluators too — scoped by the workflow id as the `application` reference.
                disabled: !hasProjectURL,
            },
            {
                key: "app-playground-link",
                title: "Playground",
                link: `${appURL || recentlyVisitedAppURL}/playground`,
                icon: <RocketIcon size={14} />,
                isHidden,
                disabled: !hasProjectURL,
            },
            {
                key: "app-variants-link",
                title: "Registry",
                link: `${appURL || recentlyVisitedAppURL}/variants`,
                isHidden,
                icon: <LightningIcon size={14} />,
                disabled: !hasProjectURL,
                dataTour: "registry-nav",
                workflowCategories: ["app", "agent"],
            },
            {
                key: "app-evaluations-link",
                title: "Evaluations",
                link: `${appURL || recentlyVisitedAppURL}/evaluations`,
                isHidden,
                icon: <FlaskIcon size={14} />,
                // Enabled for evaluators too — shows the runs scoped by the evaluator's id.
                disabled: !hasProjectURL,
                dataTour: "evaluations-nav",
            },
            {
                key: "app-traces-link",
                title: "Observability",
                icon: <TreeViewIcon size={14} />,
                isHidden,
                link: `${appURL || recentlyVisitedAppURL}/traces`,
                disabled: !hasProjectURL,
            },
        ]
    }, [
        appURL,
        currentApp,
        hasAppContext,
        hasProjectURL,
        recentlyVisitedAppId,
        recentlyVisitedAppURL,
    ])

    const projectItemsWithDynamicChildren = useMemo(
        () => injectDynamicChildren(projectItems, dynamicChildren),
        [projectItems, dynamicChildren],
    )

    return useMemo(
        () => ({
            projectItems: projectItemsWithDynamicChildren,
            appItems,
        }),
        [projectItemsWithDynamicChildren, appItems],
    )
}
