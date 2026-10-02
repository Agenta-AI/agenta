/**
 * CreateWithAIAddMenu
 *
 * A config header's "+" (Integrations, Skills, Automations): a two-row menu that offers "Create
 * with AI" beside the section's own manual add. "Create with AI" puts a starter prompt ("I want a
 * skill that …") in the chat composer, so the agent runs the setup conversation instead of the
 * user filling the form.
 */
import {useCallback, useRef, type ReactNode} from "react"

import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Sparkle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {SectionAddButton} from "./SectionAddButton"

export interface CreateWithAIAddMenuProps {
    /** Accessible name of the "+" ("Add skill"). */
    label: string
    /** Text the composer receives. The caret lands after it, so it reads as an open sentence. */
    starterPrompt: string
    /** The section's existing add flow. */
    onManual: () => void
    /** Row copy for the manual add ("Add manually"). */
    manualTitle: string
    manualHint: string
    manualIcon: ReactNode
}

/** One row: an icon, a name, a one-line hint. */
function MenuRow({
    icon,
    title,
    hint,
    onSelect,
}: {
    icon: ReactNode
    title: string
    hint: string
    onSelect: () => void
}) {
    return (
        <DropdownMenuItem onSelect={onSelect} className="items-start gap-2.5">
            <span aria-hidden className="mt-0.5 flex shrink-0 text-colorTextSecondary">
                {icon}
            </span>
            <span className="flex min-w-0 flex-col">
                <span className="text-sm text-colorText">{title}</span>
                <span className="text-xs text-colorTextTertiary">{hint}</span>
            </span>
        </DropdownMenuItem>
    )
}

export function CreateWithAIAddMenu({
    label,
    starterPrompt,
    onManual,
    manualTitle,
    manualHint,
    manualIcon,
}: CreateWithAIAddMenuProps) {
    const requestPrefill = useSetAtom(composerPrefillRequestAtom)
    // The menu hands focus back to its trigger as it closes. After "Create with AI" the composer
    // has to keep it, or the caret the prompt just placed is gone before the user types.
    const choseAIRef = useRef(false)
    const createWithAI = useCallback(() => {
        choseAIRef.current = true
        requestPrefill({id: Date.now(), text: starterPrompt})
    }, [requestPrefill, starterPrompt])

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <SectionAddButton label={label} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-[280px]"
                onCloseAutoFocus={(event) => {
                    if (!choseAIRef.current) return
                    choseAIRef.current = false
                    event.preventDefault()
                }}
            >
                <MenuRow
                    icon={<Sparkle size={16} />}
                    title="Create with AI"
                    hint="Describe what you want in the chat. The agent sets it up."
                    onSelect={createWithAI}
                />
                <MenuRow
                    icon={manualIcon}
                    title={manualTitle}
                    hint={manualHint}
                    onSelect={onManual}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
