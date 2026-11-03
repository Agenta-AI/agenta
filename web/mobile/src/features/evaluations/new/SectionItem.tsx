import type {ReactNode} from "react"

import {AccordionContent, AccordionItem, AccordionTrigger} from "@agenta/ui/ui"
import {CheckCircle, X} from "@phosphor-icons/react"

import type {NewEvaluationSection} from "./newEvaluationDraft"

export interface SectionChip {
    id: string
    label: string
    /** Absent: the pick cannot be removed from the header (the scoped app). */
    onRemove?: () => void
}

/**
 * One section of the wizard: a header with a check once complete, the picks as chips under it,
 * and the section's content while it is open.
 */
export const SectionItem = ({
    value,
    title,
    chips,
    disabled,
    children,
}: {
    value: NewEvaluationSection
    title: string
    chips: SectionChip[]
    disabled?: boolean
    children: ReactNode
}) => (
    <AccordionItem value={value}>
        <AccordionTrigger>
            <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">{title}</span>
                {chips.length > 0 ? (
                    <CheckCircle
                        aria-label={`${title} complete`}
                        role="img"
                        weight="fill"
                        className="size-4 shrink-0 text-colorSuccess"
                    />
                ) : null}
            </span>
        </AccordionTrigger>
        {chips.length > 0 ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 px-4 pb-3 pl-10">
                {chips.map((chip) => (
                    <li
                        key={chip.id}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-2 text-xs text-foreground"
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
        <AccordionContent>{children}</AccordionContent>
    </AccordionItem>
)
