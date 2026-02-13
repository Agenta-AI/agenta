import {Lightning} from "@phosphor-icons/react"

import EmptyState from "@/oss/components/EmptyState"
import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"

const EmptyStateOnlineEvaluation = ({onCreateEvaluation}: {onCreateEvaluation: () => void}) => {
    return (
        <EmptyState
            videoId={EMPTY_STATE_VIDEOS.onlineEvaluation}
            previewAlt="Online evaluation workflow demonstration"
            title="Get Started with Live Evaluation"
            description="Monitor and evaluate your LLM outputs in real-time. Set up continuous evaluation on production traffic to catch issues early."
            primaryCta={{
                label: "Create Evaluation",
                onClick: onCreateEvaluation,
                icon: <Lightning size={16} />,
            }}
            secondaryCta={{
                label: "Learn More",
                href: "https://agenta.ai/docs/evaluation/concepts#evaluation-workflows",
            }}
        />
    )
}

export default EmptyStateOnlineEvaluation
