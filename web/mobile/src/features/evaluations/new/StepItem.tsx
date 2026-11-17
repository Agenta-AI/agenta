import {CheckCircle, X} from "@phosphor-icons/react"

import type {NewEvaluationSection} from "./newEvaluationDraft"

export interface StepChip {
    id: string
    label: string
    /** Absent: the pick cannot be removed here (the scoped app, a setting). */
    onRemove?: () => void
}

export interface Step {
    section: NewEvaluationSection
    title: string
    chips: StepChip[]
    /** Whether the step shows its check. */
    complete: boolean
}

/**
 * One step in the wizard's step list: its title with a check once complete, and the picks as
 * chips under it. The title opens the step on the right.
 */
export const StepItem = ({
    step,
    active,
    disabled,
    onOpen,
}: {
    step: Step
    active: boolean
    disabled?: boolean
    onOpen: (section: NewEvaluationSection) => void
}) => (
    <li className="flex flex-col gap-1.5">
        <button
            type="button"
            aria-current={active ? "step" : undefined}
            disabled={disabled}
            onClick={() => onOpen(step.section)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted aria-[current=step]:bg-muted aria-[current=step]:font-medium aria-[current=step]:text-foreground disabled:cursor-not-allowed md:rounded-r-none md:border-r-2 md:border-solid md:border-transparent md:aria-[current=step]:border-foreground"
        >
            <span className="truncate">{step.title}</span>
            {step.complete ? (
                <CheckCircle
                    aria-label={`${step.title} complete`}
                    role="img"
                    weight="fill"
                    className="size-4 shrink-0 text-colorSuccess"
                />
            ) : null}
        </button>
        {step.chips.length > 0 ? (
            <ul
                aria-label={`${step.title} picks`}
                className="m-0 flex list-none flex-wrap gap-1.5 px-2 pb-1"
            >
                {step.chips.map((chip) => (
                    <li
                        key={chip.id}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pl-2 pr-1.5 text-xs text-foreground"
                    >
                        <span className="truncate">{chip.label}</span>
                        {chip.onRemove ? (
                            <button
                                type="button"
                                aria-label={`Remove ${chip.label}`}
                                disabled={disabled}
                                onClick={chip.onRemove}
                                className="-m-1.5 inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-1.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                            >
                                <X aria-hidden size={12} />
                            </button>
                        ) : null}
                    </li>
                ))}
            </ul>
        ) : null}
    </li>
)
