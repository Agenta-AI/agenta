import {memo} from "react"

import {useSetAtom} from "jotai"

import EmptyState from "@/oss/components/EmptyState"
import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"
import {setOnboardingWidgetActivationAtom} from "@/oss/lib/onboarding"

const EmptyObservability = () => {
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)

    const handleSetupTracing = () => {
        setOnboardingWidgetActivation("tracing-snippet")
    }

    return (
        <EmptyState
            videoId={EMPTY_STATE_VIDEOS.observability}
            previewAlt="Observability demo showing trace visualization"
            title="No traces yet"
            description="Add a few lines of code to start capturing traces from your LLM application. Monitor latency, token usage, and debug issues with detailed insights."
            primaryCta={{
                label: "Set Up Tracing",
                onClick: handleSetupTracing,
            }}
            secondaryCta={{
                label: "Learn More",
                href: "https://docs.agenta.ai/observability/quickstart",
            }}
        />
    )
}

export default memo(EmptyObservability)
