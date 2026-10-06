import {SkeletonBlock} from "@agenta/ui/ui"

import {ONBOARDING_COPY} from "../onboardingCopy"

/** Suggestion cards while the template catalog loads. */
export const OnboardingSuggestionsSkeleton = ({rows = false}: {rows?: boolean}) => (
    <div
        role="status"
        aria-label={ONBOARDING_COPY.agent.suggestionsLoading}
        className={rows ? "flex flex-col gap-2" : "flex gap-3 overflow-hidden"}
    >
        {Array.from({length: 3}, (_, index) => (
            <SkeletonBlock
                key={index}
                className={rows ? "h-[68px] rounded-xl" : "h-[104px] w-[280px] shrink-0 rounded-xl"}
            />
        ))}
    </div>
)
