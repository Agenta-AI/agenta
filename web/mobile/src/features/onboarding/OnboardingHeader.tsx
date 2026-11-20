import {useT} from "@agenta/i18n"
import flowCatalog from "@agenta/i18n/catalogs/onboarding.flow"
import {Button} from "@agenta/ui/ui"

import {AgentaLogo} from "@/components/AgentaLogo"

/** The flow's top bar: the wordmark, and a quiet way out opposite it when offered. */
export const OnboardingHeader = ({onSkip}: {onSkip?: () => void}) => {
    const t = useT(flowCatalog)
    return (
        <header className="bg-background/90 sticky top-0 z-10 flex h-[72px] shrink-0 items-center justify-center px-6 backdrop-blur-sm">
            <div className="flex w-full max-w-[1040px] items-center justify-between gap-4">
                <AgentaLogo className="h-[21px] w-auto" />
                {onSkip ? (
                    <Button
                        variant="ghost"
                        onClick={onSkip}
                        className="text-muted-foreground hover:text-foreground -mr-3 h-11 px-3 text-sm font-medium md:h-9"
                    >
                        {t("onboarding.flow.skip")}
                    </Button>
                ) : null}
            </div>
        </header>
    )
}
