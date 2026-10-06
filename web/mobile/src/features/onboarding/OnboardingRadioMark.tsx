import {cn} from "@/lib/utils"

/** The single-choice dot on a task card; the card itself carries the pressed state. */
export const OnboardingRadioMark = ({active}: {active: boolean}) => (
    <span
        aria-hidden
        className={cn(
            "ml-auto size-4 shrink-0 rounded-full border-solid",
            active ? "border-foreground border-[5px]" : "border-border border",
        )}
    />
)
