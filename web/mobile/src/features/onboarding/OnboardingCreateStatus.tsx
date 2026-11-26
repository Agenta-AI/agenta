import type {Ref} from "react"

import {useT} from "@agenta/i18n"
import creatorCatalog from "@agenta/i18n/catalogs/onboarding.creator"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import type {OnboardingCreateState} from "./OnboardingCreateState"

/** Why Create did not or cannot run: its error, else the missing model with a way to pick one. */
export const OnboardingCreateStatus = ({
    create,
    chooseModelRef,
}: {
    create: OnboardingCreateState
    chooseModelRef?: Ref<HTMLButtonElement>
}) => {
    const t = useT(creatorCatalog)
    return create.error ? (
        <span role="alert" className="text-destructive text-xs">
            {create.error}
        </span>
    ) : !create.modelReady && !create.pending ? (
        <span className="text-muted-foreground text-xs">
            {t("onboarding.creator.modelMissing")}{" "}
            <button
                ref={chooseModelRef}
                type="button"
                onClick={create.onChooseModel}
                className={cn(
                    "text-foreground cursor-pointer rounded-sm border-0 bg-transparent p-0 text-xs underline",
                    FOCUS_RING,
                )}
            >
                {t("onboarding.creator.modelMissingAction")}
            </button>
        </span>
    ) : null
}
