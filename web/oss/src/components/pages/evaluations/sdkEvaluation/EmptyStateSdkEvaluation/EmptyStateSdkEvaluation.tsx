import {Code} from "@phosphor-icons/react"

import EmptyState from "@/oss/components/EmptyState"
import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"

interface EmptyStateSdkEvaluationProps {
    onOpenSetupModal?: () => void
}

const EmptyStateSdkEvaluation = ({onOpenSetupModal}: EmptyStateSdkEvaluationProps) => {
    return (
        <EmptyState
            videoId={EMPTY_STATE_VIDEOS.evaluation}
            previewAlt="SDK evaluation workflow demonstration"
            title="Get Started with SDK Evaluations"
            description="Run evaluations programmatically using the Agenta SDK. Integrate evaluations into your CI/CD pipeline or run them from your codebase."
            primaryCta={{
                label: "Get Started",
                onClick: onOpenSetupModal ?? (() => {}),
                icon: <Code size={16} />,
            }}
            secondaryCta={{
                label: "Learn More",
                href: "https://docs.agenta.ai/evaluation/evaluation-from-sdk/quick-start",
            }}
        />
    )
}

export default EmptyStateSdkEvaluation
