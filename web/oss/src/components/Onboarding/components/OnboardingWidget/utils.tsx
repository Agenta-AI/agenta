import {CHECKLIST_PREREQUISITES} from "./constants"
import {ChecklistContext, ChecklistSection} from "./types"

export const buildChecklistSections = ({
    projectURL,
    appURL,
    recentlyVisitedAppURL,
}: ChecklistContext): ChecklistSection[] => {
    const appBase = appURL || recentlyVisitedAppURL
    const hasAppTarget = Boolean(appBase)
    const evaluationBase = projectURL ? `${projectURL}/evaluations` : ""

    const getEvaluationLink = (tab: string) =>
        evaluationBase ? `${evaluationBase}?selectedEvaluation=${tab}` : undefined

    return [
        {
            id: "guides",
            title: "Guides",
            items: [
                {
                    id: "create-first-prompt",
                    title: "Create your first prompt",
                    description: "Open the playground and design your first prompt or template.",
                    href: hasAppTarget ? `${appBase}/playground` : undefined,
                    disabled: !hasAppTarget,
                    tip: hasAppTarget ? undefined : "Select an app to enter the playground.",
                    cta: hasAppTarget ? "Go to Playground" : "Open App Management",
                    tour: {section: "playground", tourId: "playground-quickstart"},
                    prerequisites: [CHECKLIST_PREREQUISITES.needsApp],
                },
                {
                    id: "first-evaluation",
                    title: "Run your first evaluation",
                    description: "Compare prompts with a quick automatic evaluation.",
                    href: getEvaluationLink("auto_evaluation"),
                    disabled: !evaluationBase,
                    tip: evaluationBase
                        ? undefined
                        : "You need a project before you can run evaluations.",
                    cta: "Launch evaluation",
                    tour: {section: "autoEvaluation", tourId: "one-click-auto-evaluation"},
                    prerequisites: [CHECKLIST_PREREQUISITES.needsProject],
                },
                {
                    id: "online-evaluation",
                    title: "Set up online evaluation",
                    description: "Send live traffic to variants and capture production results.",
                    href: getEvaluationLink("online_evaluation"),
                    disabled: !evaluationBase,
                    tip: evaluationBase
                        ? undefined
                        : "Project-level access is required for online evaluations.",
                    cta: "Configure online eval",
                    tour: {section: "onlineEvaluation", tourId: "one-click-online-evaluation"},
                    prerequisites: [CHECKLIST_PREREQUISITES.needsProject],
                },
            ],
        },
        {
            id: "integrations",
            title: "Technical Integrations",
            items: [
                {
                    id: "prompt-management",
                    title: "Set up prompt management",
                    description: "Organize prompt variants in the registry for easy deployment.",
                    href: hasAppTarget ? `${appBase}/variants` : undefined,
                    disabled: !hasAppTarget,
                    tip: hasAppTarget ? undefined : "Select an app to reach the registry.",
                    cta: "Open registry",
                    tour: {section: "apps"},
                    prerequisites: [CHECKLIST_PREREQUISITES.needsApp],
                },
                {
                    id: "set-up-tracing",
                    title: "Set up tracing",
                    description: "Inspect traces and annotate executions for better observability.",
                    href: projectURL ? `${projectURL}/apps` : undefined,
                    disabled: !projectURL,
                    tip: projectURL ? undefined : "Select a project to configure tracing.",
                    cta: "Open app management",
                    tour: {section: "apps", tourId: "trace-setup"},
                    prerequisites: [CHECKLIST_PREREQUISITES.needsProject],
                },
            ],
        },
        {
            id: "collaboration",
            title: "Collaboration",
            items: [
                {
                    id: "invite-team",
                    title: "Invite your team",
                    description:
                        "Share Agenta with collaborators directly from workspace settings.",
                    href: projectURL
                        ? `${projectURL}/settings?tab=workspace&inviteModal=open`
                        : undefined,
                    disabled: !projectURL,
                    tip: projectURL
                        ? undefined
                        : "Create or open a workspace project to manage teammates.",
                    cta: "Open workspace settings",
                    prerequisites: [CHECKLIST_PREREQUISITES.needsProject],
                },
            ],
        },
    ]
}

export const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max)
