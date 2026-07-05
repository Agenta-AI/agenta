import {Spin} from "antd"

/**
 * The single loading surface for playground-native onboarding. Used at every boundary the onboarding
 * flow crosses — the `/apps` redirect decision, the lazy-`Playground` chunk download, and the ephemeral
 * mint — so the user sees ONE continuous "setting up" screen instead of a basic spinner → header shell →
 * mint spinner. Fills the same content area (`100dvh - 46px` top bar) at each boundary for continuity.
 */
const OnboardingLoader = () => (
    <div className="flex h-[calc(100dvh-46px)] w-full flex-col items-center justify-center gap-3">
        <Spin />
        <span className="text-xs text-[var(--ag-colorTextSecondary)]">Setting up your agent…</span>
    </div>
)

export default OnboardingLoader
