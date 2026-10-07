import {LoadError} from "@agenta/ui/components/presentational"

import {ONBOARDING_COPY} from "../onboardingCopy"
import {OnboardingHeader} from "../OnboardingHeader"

/** The draft agent could not be minted; the retry releases the mint's guard. */
export const OnboardingFlowError = ({onRetry}: {onRetry: () => void}) => (
    <div className="bg-background text-foreground flex h-dvh flex-col">
        <OnboardingHeader />
        <div className="flex flex-1 items-center justify-center px-4 pb-24">
            <LoadError title={ONBOARDING_COPY.mintError} onRetry={onRetry} />
        </div>
    </div>
)
