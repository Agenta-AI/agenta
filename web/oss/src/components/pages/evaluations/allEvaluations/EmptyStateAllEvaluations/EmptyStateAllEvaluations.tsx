import {Play} from "@phosphor-icons/react"

import EmptyState from "@/oss/components/EmptyState"
import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"

const EmptyStateAllEvaluations = ({onCreateEvaluation}: {onCreateEvaluation: () => void}) => {
    return (
        <EmptyState
            videoId={EMPTY_STATE_VIDEOS.evaluation}
            previewAlt="Evaluation workflow demonstration"
            title="Get Started with Evaluations"
            description="Compare prompt versions, catch regressions, and measure quality automatically. Create evaluation templates and let Agenta score your outputs."
            primaryCta={{
                label: "Run Evaluation",
                onClick: onCreateEvaluation,
                icon: <Play size={16} />,
            }}
            secondaryCta={{
                label: "Learn More",
                href: "https://docs.agenta.ai/evaluation/overview",
            }}
        />
    )
}

export default EmptyStateAllEvaluations
