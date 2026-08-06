import {Users} from "@phosphor-icons/react"

import EmptyState from "@/oss/components/EmptyState"
import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"

const EmptyStateHumanEvaluation = ({onCreateEvaluation}: {onCreateEvaluation: () => void}) => {
    return (
        <EmptyState
            videoId={EMPTY_STATE_VIDEOS.evaluation}
            previewAlt="Human evaluation workflow demonstration"
            title="Get Started with Human Evaluation"
            description="Collect human feedback on your LLM outputs. Set up annotation tasks and gather quality assessments from your team."
            primaryCta={{
                label: "Create Evaluation",
                onClick: onCreateEvaluation,
                icon: <Users size={16} />,
            }}
            secondaryCta={{
                label: "Learn More",
                href: "https://agenta.ai/docs/evaluation/human-evaluation/quick-start",
            }}
        />
    )
}

export default EmptyStateHumanEvaluation
