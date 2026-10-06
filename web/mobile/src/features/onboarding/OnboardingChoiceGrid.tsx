import {Check} from "@phosphor-icons/react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {choiceCardClass, toneAt, type OnboardingChoice} from "./onboardingChoices"

/** One question, answered by a single card: the role and referral steps. */
export const OnboardingChoiceGrid = <Label extends string>({
    choices,
    value,
    onPick,
    labelledBy,
    tall = false,
}: {
    choices: readonly OnboardingChoice<Label>[]
    value: Label | null
    onPick: (label: Label) => void
    /** The step heading that asks the question. */
    labelledBy: string
    /** Icon above the label, three across on wide screens. */
    tall?: boolean
}) => (
    <div
        role="group"
        aria-labelledby={labelledBy}
        className={cn(
            "grid gap-3",
            tall ? "grid-cols-2 md:grid-cols-3" : "grid-cols-1 sm:grid-cols-2",
        )}
    >
        {choices.map(({label, icon: Icon}, index) => {
            const active = value === label
            return (
                <button
                    type="button"
                    key={label}
                    aria-pressed={active}
                    onClick={() => onPick(label)}
                    className={cn(
                        choiceCardClass(active),
                        FOCUS_RING,
                        "relative flex",
                        tall
                            ? "h-[108px] flex-col items-start justify-between lg:h-[124px]"
                            : "h-16 items-center gap-3",
                    )}
                >
                    <span
                        className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-[9px]",
                            toneAt(index),
                        )}
                    >
                        <Icon size={20} weight="fill" />
                    </span>
                    <span className="text-[15px] leading-tight">{label}</span>
                    {active ? <Check size={14} className="absolute right-2 top-2" /> : null}
                </button>
            )
        })}
    </div>
)
