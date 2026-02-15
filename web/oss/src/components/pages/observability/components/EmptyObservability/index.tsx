import {memo} from "react"

import {BranchesOutlined} from "@ant-design/icons"
import {Typography} from "antd"
import {useSetAtom} from "jotai"

import EmptyState from "@/oss/components/EmptyState"
import {EMPTY_STATE_VIDEOS} from "@/oss/components/EmptyState/videos"
import EmptyComponent from "@/oss/components/Placeholders/EmptyComponent"
import {setOnboardingWidgetActivationAtom} from "@/oss/lib/onboarding"

interface EmptyObservabilityProps {
    showOnboarding?: boolean
}

const EmptyObservability = ({showOnboarding = true}: EmptyObservabilityProps) => {
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)

    const handleSetupTracing = () => {
        setOnboardingWidgetActivation("tracing-snippet")
    }

    if (!showOnboarding) {
        return (
            <div className="py-16">
                <EmptyComponent
                    image={<BranchesOutlined style={{fontSize: 32, color: "#d9d9d9"}} />}
                    description={
                        <div className="flex flex-col gap-2">
                            <Typography.Text className="text-lg font-medium">
                                No traces found
                            </Typography.Text>
                            <Typography.Text type="secondary">
                                Try adjusting your filters or time range to view traces.
                            </Typography.Text>
                        </div>
                    }
                />
            </div>
        )
    }

    return (
        <EmptyState
            className="py-4"
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
