import {Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"

import type {EvaluationKindTab} from "../useEvaluationRunsFilters"

interface EmptyCopy {
    title: string
    description: string
    learnMoreHref: string
}

const COPY: Record<EvaluationKindTab, EmptyCopy> = {
    all: {
        title: "Get started with evaluations",
        description:
            "Track auto, human, live, and SDK evaluations in one place. Start an evaluation by choosing the type that matches your workflow.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/overview",
    },
    auto: {
        title: "Get started with auto evaluations",
        description:
            "Compare prompt versions, catch regressions, and measure quality automatically. Create evaluation templates and let Agenta score your outputs.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/overview",
    },
    human: {
        title: "Get started with human evaluation",
        description:
            "Collect human feedback on your LLM outputs. Set up annotation tasks and gather quality assessments from your team.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/human-evaluation/quick-start",
    },
    online: {
        title: "Get started with live evaluation",
        description:
            "Monitor and evaluate your LLM outputs in real-time. Set up continuous evaluation on production traffic to catch issues early.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/concepts#evaluation-workflows",
    },
    custom: {
        title: "Get started with SDK evaluations",
        description:
            "Run evaluations programmatically using the Agenta SDK. Integrate evaluations into your CI/CD pipeline or run them from your codebase.",
        learnMoreHref: "https://docs.agenta.ai/evaluation/evaluation-from-sdk/quick-start",
    },
}

/** The tab has no runs at all (no search, no filter). The toolbar holds the create button. */
export const EvaluationsEmpty = ({kind}: {kind: EvaluationKindTab}) => {
    const copy = COPY[kind]
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyTitle>{copy.title}</EmptyTitle>
                <EmptyDescription>{copy.description}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
                <Button asChild size="sm" variant="outline">
                    <a href={copy.learnMoreHref} target="_blank" rel="noreferrer">
                        Learn more
                    </a>
                </Button>
            </EmptyContent>
        </Empty>
    )
}
