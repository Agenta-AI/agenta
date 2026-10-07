import {SkeletonBlock} from "@agenta/ui/ui"

import {ONBOARDING_COPY} from "../onboardingCopy"

/** The template rows while the catalog loads. */
export const OnboardingGallerySkeleton = () => (
    <div role="status" aria-label={ONBOARDING_COPY.gallery.loading} className="flex flex-col gap-1">
        {Array.from({length: 6}, (_, index) => (
            <SkeletonBlock key={index} className="h-14 rounded-lg" />
        ))}
    </div>
)
