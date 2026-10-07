import {LoadError} from "@agenta/ui/components/presentational"

import {AgentaLogo} from "@/components/AgentaLogo"

import {ONBOARDING_COPY} from "../onboardingCopy"

/** The draft agent could not be minted; the retry releases the mint's guard. */
export const OnboardingFlowError = ({onRetry}: {onRetry: () => void}) => (
    <main className="bg-background text-foreground flex h-dvh flex-col">
        <header className="mx-auto flex h-16 w-full max-w-[1040px] items-center px-4 lg:h-[72px] lg:px-6">
            <AgentaLogo className="h-5 w-auto" />
        </header>
        <div className="flex flex-1 items-center justify-center px-4">
            <LoadError title={ONBOARDING_COPY.mintError} onRetry={onRetry} />
        </div>
    </main>
)
