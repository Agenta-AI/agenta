import {Button} from "antd"

import AgentChatSkeleton from "@/oss/components/AgentChatSlice/components/AgentChatSkeleton"
import PlaygroundLoadingShell from "@/oss/components/PlaygroundRouter/PlaygroundLoadingShell"

interface OnboardingLoaderProps {
    /** Mint failed — show a retry affordance instead of an endless skeleton. */
    error?: boolean
    onRetry?: () => void
}

/**
 * The single loading surface for playground-native onboarding. Used at every boundary the onboarding
 * flow crosses — the `/apps` redirect decision, the lazy-`Playground` chunk download, and the ephemeral
 * mint — so the user sees ONE continuous screen: the real agent playground shell (agent header + the
 * live chat skeleton) rather than a bare spinner. Onboarding always targets an agent, so we force the
 * agent header without waiting for any data to resolve. On mint failure the body swaps to an error +
 * Retry so the flow never dead-ends.
 */
const OnboardingLoader = ({error, onRetry}: OnboardingLoaderProps = {}) => (
    <PlaygroundLoadingShell agent>
        {error ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                    Couldn&apos;t set up your agent.
                </span>
                {onRetry ? (
                    <Button onClick={onRetry} type="primary">
                        Try again
                    </Button>
                ) : null}
            </div>
        ) : (
            <AgentChatSkeleton />
        )}
    </PlaygroundLoadingShell>
)

export default OnboardingLoader
