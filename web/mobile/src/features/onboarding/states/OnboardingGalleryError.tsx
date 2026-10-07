import {LoadError} from "@agenta/ui/components/presentational"

import {ONBOARDING_COPY} from "../onboardingCopy"

/** A failed catalog read; New agent stays above it, so the flow never dead-ends. */
export const OnboardingGalleryError = ({onRetry}: {onRetry: () => void}) => (
    <LoadError title={ONBOARDING_COPY.gallery.loadError} onRetry={onRetry} />
)
