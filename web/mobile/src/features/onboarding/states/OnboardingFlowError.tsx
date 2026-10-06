import {LoadError} from "@agenta/ui/components/presentational"

import {AgentaLogo} from "@/components/AgentaLogo"

import {ONBOARDING_COPY} from "../onboardingCopy"

/** The draft agent could not be minted; the retry releases the mint's guard. */
export const OnboardingFlowError = ({onRetry}: {onRetry: () => void}) => (
    <main className="bg-background text-foreground flex h-dvh flex-col">
        <header className="mx-auto w-full max-w-[1200px] px-4 pt-6 lg:px-8 lg:pt-8">
            <AgentaLogo className="h-6 w-auto" />
        </header>
        <div className="flex flex-1 items-center justify-center px-4">
            <LoadError title={ONBOARDING_COPY.mintError} onRetry={onRetry} />
        </div>
    </main>
)
