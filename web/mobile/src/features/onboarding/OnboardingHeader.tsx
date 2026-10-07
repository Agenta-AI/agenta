import {AgentaLogo} from "@/components/AgentaLogo"

/** The flow's top bar: only the wordmark, as in the design. */
export const OnboardingHeader = () => (
    <header className="bg-background/90 sticky top-0 z-10 flex h-[72px] shrink-0 items-center justify-center px-6 backdrop-blur-sm">
        <div className="flex w-full max-w-[1040px] items-center">
            <AgentaLogo className="h-[21px] w-auto" />
        </div>
    </header>
)
