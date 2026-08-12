/**
 * The connection card's "Harnesses" section.
 *
 * A harness is the program that talks to the model and uses tools (Pi, Claude Code, Codex). The
 * checked set is user policy; the harness catalog is the technical limit underneath it, so a
 * harness that cannot reach this provider is shown disabled with the reason rather than hidden —
 * a missing row reads as a bug, a disabled one explains itself.
 *
 * Collapsed by default and always showing its value ("Harnesses: runs in Pi"), so the card's
 * common path stays short without hiding what it decided.
 */
import {useState} from "react"

import {cn} from "@agenta/ui/styles"
import {Checkbox} from "@agenta/ui/ui"
import {CaretDown, CaretRight} from "@phosphor-icons/react"

export interface HarnessChoice {
    id: string
    label: string
    /** False when the harness catalog says this harness cannot reach the provider. */
    supported: boolean
}

export interface HarnessesSectionProps {
    choices: HarnessChoice[]
    selected: string[]
    onToggle: (id: string, checked: boolean) => void
    /** Nothing is checked because nobody chose — the connection stays open to any harness. */
    unrestricted?: boolean
}

const summarize = (choices: HarnessChoice[], selected: string[], unrestricted: boolean): string => {
    const labels = choices
        .filter((choice) => selected.includes(choice.id))
        .map((choice) => choice.label)

    if (labels.length === 0) {
        return unrestricted ? "any harness Agenta supports" : "no harness selected"
    }
    if (labels.length === 1) return `runs in ${labels[0]}`
    return `runs in ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

const HarnessesSection = ({
    choices,
    selected,
    onToggle,
    unrestricted = false,
}: HarnessesSectionProps) => {
    const [expanded, setExpanded] = useState(false)

    return (
        <section className="flex flex-col gap-2">
            <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
                aria-expanded={expanded}
            >
                {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                <span className="font-medium text-colorText">Harnesses:</span>
                <span className="text-colorTextSecondary">
                    {summarize(choices, selected, unrestricted)}
                </span>
            </button>

            {expanded ? (
                <div className="flex flex-col gap-2 pl-6">
                    {choices.map((choice) => (
                        <label
                            key={choice.id}
                            className={cn(
                                "flex items-center gap-2",
                                choice.supported ? "cursor-pointer" : "cursor-not-allowed",
                            )}
                        >
                            <Checkbox
                                checked={selected.includes(choice.id)}
                                disabled={!choice.supported}
                                onCheckedChange={(next) => onToggle(choice.id, next === true)}
                            />
                            <span
                                className={
                                    choice.supported ? "text-colorText" : "text-colorTextDisabled"
                                }
                            >
                                {choice.label}
                            </span>
                            {choice.supported ? null : (
                                <span className="text-colorTextSecondary">
                                    cannot reach this provider
                                </span>
                            )}
                        </label>
                    ))}
                </div>
            ) : null}
        </section>
    )
}

export default HarnessesSection
