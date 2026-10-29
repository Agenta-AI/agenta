/** The connection card's Harnesses: which harnesses may use it, with unreachable ones disabled. */
import {useRef, useState} from "react"

import {harnessSummary} from "@agenta/entities/secret"
import {cn} from "@agenta/ui/styles"
import {Checkbox, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"

import {harnessMarkFor} from "./harnessMark"

export interface HarnessChoice {
    id: string
    label: string
    /** False when the harness catalog says this harness cannot reach the provider. */
    supported: boolean
    /** Shown beside the label when the harness has one (Pi's pi.dev, and nothing else today). */
    domain?: string
}

export interface HarnessesSectionProps {
    choices: HarnessChoice[]
    selected: string[]
    onToggle: (id: string, checked: boolean) => void
    /** Nothing is checked because nobody chose — the connection stays open to any harness. */
    unrestricted?: boolean
}

const HarnessesSection = ({
    choices,
    selected,
    onToggle,
    unrestricted = false,
}: HarnessesSectionProps) => {
    const [expanded, setExpanded] = useState(false)
    const sectionRef = useRef<HTMLElement>(null)

    const enabled = choices.filter((choice) => selected.includes(choice.id))
    const summary = harnessSummary(
        enabled.map((choice) => choice.label),
        unrestricted,
    )

    return (
        <section ref={sectionRef} className="flex shrink-0 flex-col">
            <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
                aria-expanded={expanded}
            >
                <span className="font-medium text-colorText">Harnesses</span>
                {enabled.length ? (
                    <TooltipProvider delayDuration={300}>
                        <span className="flex items-center gap-1" aria-label={summary}>
                            {enabled.map((choice) => {
                                const Mark = harnessMarkFor(choice.id)
                                return (
                                    <Tooltip key={choice.id}>
                                        <TooltipTrigger asChild>
                                            <span className="inline-flex">
                                                {Mark ? (
                                                    <Mark className="size-3.5 shrink-0" />
                                                ) : (
                                                    <span className="text-colorTextSecondary">
                                                        {choice.label}
                                                    </span>
                                                )}
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>{choice.label}</TooltipContent>
                                    </Tooltip>
                                )
                            })}
                        </span>
                    </TooltipProvider>
                ) : (
                    <span className="text-colorTextSecondary">· {summary}</span>
                )}
                <CaretRight
                    size={12}
                    className={cn(
                        "text-colorTextTertiary transition-transform",
                        expanded && "rotate-90",
                    )}
                />
            </button>

            {/* Animates height through grid rows; once open, the section scrolls into view. */}
            <div
                inert={!expanded}
                onTransitionEnd={(event) => {
                    if (event.propertyName !== "grid-template-rows" || !expanded) return
                    if (event.target !== event.currentTarget) return
                    sectionRef.current?.scrollIntoView({behavior: "smooth", block: "nearest"})
                }}
                className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                    expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
            >
                <div className="flex min-h-0 flex-col gap-2 overflow-hidden pt-2">
                    <span className="text-colorTextSecondary">Enable this connection in</span>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
                        {choices.map((choice) => {
                            const Mark = harnessMarkFor(choice.id)
                            const checked = selected.includes(choice.id)

                            return (
                                <label
                                    key={choice.id}
                                    className={cn(
                                        "box-border flex min-w-0 flex-col gap-1 rounded-lg border border-solid p-3 transition-colors",
                                        checked ? "border-primary bg-primary/5" : "border-border",
                                        choice.supported
                                            ? "cursor-pointer hover:border-primary"
                                            : "cursor-not-allowed opacity-60",
                                    )}
                                >
                                    <span className="mb-1 flex items-center justify-between">
                                        {Mark ? <Mark className="size-5 shrink-0" /> : <span />}
                                        <Checkbox
                                            checked={checked}
                                            disabled={!choice.supported}
                                            onCheckedChange={(next) =>
                                                onToggle(choice.id, next === true)
                                            }
                                        />
                                    </span>
                                    <span
                                        className={cn(
                                            "truncate font-medium",
                                            choice.supported
                                                ? "text-colorText"
                                                : "text-colorTextDisabled",
                                        )}
                                    >
                                        {choice.label}
                                    </span>
                                    <span className="text-[11px] leading-4 text-colorTextTertiary">
                                        {choice.supported
                                            ? (choice.domain ?? " ")
                                            : "Incompatible with this provider"}
                                    </span>
                                </label>
                            )
                        })}
                    </div>
                    <span className="text-[11px] text-colorTextTertiary">
                        Each enabled harness adds this connection&apos;s models to the model picker.
                    </span>
                </div>
            </div>
        </section>
    )
}

export default HarnessesSection
