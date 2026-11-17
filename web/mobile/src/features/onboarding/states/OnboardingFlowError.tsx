import {useT} from "@agenta/i18n"
import flowCatalog from "@agenta/i18n/catalogs/onboarding.flow"
import {LoadError} from "@agenta/ui/components/presentational"

import {OnboardingHeader} from "../OnboardingHeader"

/** The draft agent could not be minted; the retry releases the mint's guard. */
export const OnboardingFlowError = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(flowCatalog)
    return (
        <div className="bg-background text-foreground flex h-dvh flex-col">
            <OnboardingHeader />
            <div className="flex flex-1 items-center justify-center px-4 pb-24">
                <LoadError title={t("onboarding.flow.mintError")} onRetry={onRetry} />
            </div>
        </div>
    )
}
