import type {Ref} from "react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"

const copy = ONBOARDING_COPY.creator

/** Why Create did not or cannot run: its error, else the missing model with a way to pick one. */
export const OnboardingCreateStatus = ({
    create,
    chooseModelRef,
}: {
    create: OnboardingCreateState
    chooseModelRef?: Ref<HTMLButtonElement>
}) =>
    create.error ? (
        <span role="alert" className="text-destructive text-xs">
            {create.error}
        </span>
    ) : !create.modelReady && !create.pending ? (
        <span className="text-muted-foreground text-xs">
            {copy.modelMissing}{" "}
            <button
                ref={chooseModelRef}
                type="button"
                onClick={create.onChooseModel}
                className={cn(
                    "text-foreground cursor-pointer rounded-sm border-0 bg-transparent p-0 text-xs underline",
                    FOCUS_RING,
                )}
            >
                {copy.modelMissingAction}
            </button>
        </span>
    ) : null
