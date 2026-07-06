import {Button, Spin} from "antd"

interface OnboardingLoaderProps {
    /** Mint failed — show a retry affordance instead of an endless spinner. */
    error?: boolean
    onRetry?: () => void
}

/**
 * The single loading surface for playground-native onboarding. Used at every boundary the onboarding
 * flow crosses — the `/apps` redirect decision, the lazy-`Playground` chunk download, and the ephemeral
 * mint — so the user sees ONE continuous "setting up" screen instead of a basic spinner → header shell →
 * mint spinner. Fills the same content area (`100dvh - 46px` top bar) at each boundary for continuity.
 * On mint failure it swaps the spinner for an error + Retry so the flow never dead-ends.
 */
const OnboardingLoader = ({error, onRetry}: OnboardingLoaderProps = {}) => (
    <div className="flex h-[calc(100dvh-46px)] w-full flex-col items-center justify-center gap-3">
        {error ? (
            <>
                <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                    Couldn&apos;t set up your agent.
                </span>
                {onRetry ? (
                    <Button onClick={onRetry} type="primary">
                        Try again
                    </Button>
                ) : null}
            </>
        ) : (
            <>
                <Spin />
                <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                    Setting up your agent…
                </span>
            </>
        )}
    </div>
)

export default OnboardingLoader
