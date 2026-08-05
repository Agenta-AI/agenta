import Reveal from "./Reveal"

/**
 * Config-slot placeholder shown for the beat between committing a template/prompt and the real agent
 * config being resolved — so the config panel doesn't mount half-loaded and pop its sections in one by
 * one. A config-shaped skeleton (fades in via `Reveal`); the onboarding reveals the real config only
 * once it's ready (see `useAgentOnboarding`), so the swap is one clean appearance, not staggered.
 */
const SkeletonSection = () => (
    <div className="flex flex-col gap-2 rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] p-3">
        <div className="h-2.5 w-24 rounded bg-[var(--ag-colorFillSecondary)]" />
        <div className="h-7 w-full rounded bg-[var(--ag-colorFillTertiary)]" />
    </div>
)

const OnboardingConfigSettling = () => (
    <Reveal className="flex h-full flex-col gap-3 p-4">
        <div className="h-2.5 w-32 rounded bg-[var(--ag-colorFillSecondary)]" />
        <div className="flex animate-pulse flex-col gap-3">
            <SkeletonSection />
            <SkeletonSection />
            <SkeletonSection />
        </div>
    </Reveal>
)

export default OnboardingConfigSettling
