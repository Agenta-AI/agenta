import EmptyState from "@/oss/components/EmptyState"
import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"
import EvaluationRunsCreateButton from "@/oss/components/EvaluationRunsTablePOC/components/EvaluationRunsCreateButton"

const EmptyStateAllEvaluations = () => {
    return (
        <EmptyState
            videoId={EMPTY_STATE_VIDEOS.evaluation}
            previewAlt="All evaluation types overview"
            title="Get Started with All Evaluations"
            description="Track auto, human, live, and SDK evaluations in one place. Start an evaluation by choosing the type that matches your workflow."
            primaryCta={{
                node: (
                    <EvaluationRunsCreateButton
                        label="Start evaluation"
                        size="large"
                        className="!px-8"
                    />
                ),
            }}
            secondaryCta={{
                label: "Learn More",
                href: "https://docs.agenta.ai/evaluation/overview",
            }}
        />
    )
}

export default EmptyStateAllEvaluations
