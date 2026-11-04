import type {ReactNode} from "react"

import {Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"
import {Code, Play, Users} from "@phosphor-icons/react"

import type {CreatableKind} from "../CreateEvaluationMenu"
import type {EvaluationKindTab} from "../useEvaluationRunsFilters"

interface EmptyCopy {
    title: string
    description: string
    learnMoreHref: string
    /** The button that starts a run of this tab's kind. Absent: the tab has none yet. */
    start?: {kind: CreatableKind; label: string; icon: ReactNode}
}

const COPY: Record<EvaluationKindTab, EmptyCopy> = {
    all: {
        title: "Get Started with All Evaluations",
        description:
            "Track auto, human, live, and SDK evaluations in one place. Start an evaluation by choosing the type that matches your workflow.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/overview",
    },
    auto: {
        title: "Get Started with Evaluations",
        description:
            "Compare prompt versions, catch regressions, and measure quality automatically. Create evaluation templates and let Agenta score your outputs.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/overview",
        start: {kind: "auto", label: "Run Evaluation", icon: <Play aria-hidden size={14} />},
    },
    human: {
        title: "Get Started with Human Evaluation",
        description:
            "Collect human feedback on your LLM outputs. Set up annotation tasks and gather quality assessments from your team.",
        learnMoreHref: "https://agenta.ai/docs/evaluation/human-evaluation/quick-start",
        start: {kind: "human", label: "Create Evaluation", icon: <Users aria-hidden size={14} />},
    },
    online: {
        title: "Get Started with Live Evaluation",
        description:
            "Monitor and evaluate your LLM outputs in real-time. Set up continuous evaluation on production traffic to catch issues early.",
        learnMoreHref: "https://agenta.ai/docs/evaluation/concepts#evaluation-workflows",
    },
    custom: {
        title: "Get Started with SDK Evaluations",
        description:
            "Run evaluations programmatically using the Agenta SDK. Integrate evaluations into your CI/CD pipeline or run them from your codebase.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/evaluation-from-sdk/quick-start",
        start: {kind: "custom", label: "Get Started", icon: <Code aria-hidden size={14} />},
    },
}

/**
 * The tab has no runs at all (no search, no filter). `createMenu` is the "Start evaluation" menu
 * of the All tab. Without a create handler no start button shows, only "Learn More".
 */
export const EvaluationsEmpty = ({
    kind,
    onCreate,
    createMenu,
}: {
    kind: EvaluationKindTab
    onCreate?: (kind: CreatableKind) => void
    createMenu?: ReactNode
}) => {
    const copy = COPY[kind]
    const start = copy.start
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyTitle>{copy.title}</EmptyTitle>
                <EmptyDescription>{copy.description}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
                {kind === "all" ? createMenu : null}
                {start && onCreate ? (
                    <Button size="sm" onClick={() => onCreate(start.kind)}>
                        {start.icon}
                        {start.label}
                    </Button>
                ) : null}
                <Button asChild size="sm" variant="outline">
                    <a href={copy.learnMoreHref} target="_blank" rel="noreferrer">
                        Learn More
                    </a>
                </Button>
            </EmptyContent>
        </Empty>
    )
}
