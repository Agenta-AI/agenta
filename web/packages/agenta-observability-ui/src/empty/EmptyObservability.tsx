import {memo, type ReactNode} from "react"

import {EmptyPlaceholder, EmptyState} from "@agenta/ui/components/presentational"
import {ProhibitIcon, TreeStructureIcon} from "@phosphor-icons/react"

export interface EmptyObservabilityProps {
    showOnboarding?: boolean
    rateLimited?: boolean
    rateLimitMessage?: string
    /** Cloudflare Stream id for the onboarding video. Host-supplied. */
    videoId?: string
    /** Fires the host's onboarding widget (OSS: the `tracing-snippet` step). */
    onSetupTracing?: () => void
    /** Rendered after the rate-limit copy — OSS passes its billing `<Link>`. */
    upgradeAction?: ReactNode
}

export const EmptyObservability = memo(
    ({
        showOnboarding = true,
        rateLimited = false,
        rateLimitMessage,
        videoId,
        onSetupTracing,
        upgradeAction,
    }: EmptyObservabilityProps) => {
        if (rateLimited) {
            return (
                <div className="py-16">
                    <EmptyPlaceholder
                        image={<ProhibitIcon size={32} />}
                        description={
                            <div className="flex flex-col gap-2">
                                <span className="text-lg font-medium text-colorText">
                                    Rate limit reached
                                </span>
                                <span className="text-colorTextSecondary">
                                    {rateLimitMessage ||
                                        "You have reached your monthly quota limit. Please try again later or upgrade your plan."}
                                    {upgradeAction ? <> {upgradeAction}</> : null}
                                </span>
                            </div>
                        }
                    />
                </div>
            )
        }

        if (!showOnboarding) {
            return (
                <div className="py-16">
                    <EmptyPlaceholder
                        image={<TreeStructureIcon size={32} className="text-colorTextQuaternary" />}
                        description={
                            <div className="flex flex-col gap-2">
                                <span className="text-lg font-medium text-colorText">
                                    No traces found
                                </span>
                                <span className="text-colorTextSecondary">
                                    Try adjusting your filters or time range to view traces.
                                </span>
                            </div>
                        }
                    />
                </div>
            )
        }

        return (
            <EmptyState
                className="py-4"
                videoId={videoId}
                previewAlt="Observability demo showing trace visualization"
                title="No traces yet"
                description="Add a few lines of code to start capturing traces from your LLM application. Monitor latency, token usage, and debug issues with detailed insights."
                primaryCta={{label: "Set Up Tracing", onClick: onSetupTracing}}
                secondaryCta={{
                    label: "Learn More",
                    href: "https://docs.agenta.ai/observability/quickstart",
                }}
            />
        )
    },
)

export default EmptyObservability
