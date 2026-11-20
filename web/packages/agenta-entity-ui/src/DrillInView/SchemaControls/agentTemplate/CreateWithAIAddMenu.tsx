/**
 * CreateWithAIAddMenu
 *
 * A config header's "+" (Integrations, Skills, Automations): a two-row menu that offers "Create
 * with AI" beside the section's own manual add. "Create with AI" puts a starter prompt ("I want a
 * skill that …") in the chat composer, so the agent runs the setup conversation instead of the
 * user filling the form.
 */
import {useCallback, useRef, type ReactElement, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"

import {SectionAddButton} from "./SectionAddButton"

/** One manual row of the menu: an icon, a name, a hint. */
export interface CreateWithAIMenuItem {
    key: string
    icon: ReactNode
    title: string
    hint: string
    onSelect: () => void
}

export interface CreateWithAIAddMenuProps {
    /** Accessible name of the "+" ("Add skill"). A `trigger` names itself. */
    label: string
    /** Text the composer receives. The caret lands after it, so it reads as an open sentence. */
    starterPrompt: string
    /** The section's existing add flow. */
    onManual?: () => void
    /** Row copy for the manual add ("Add manually"). */
    manualTitle?: string
    manualHint?: string
    manualIcon?: ReactNode
    /** Several manual rows in place of the one above (for example one per kind). */
    manualItems?: CreateWithAIMenuItem[]
    /** "Create with AI" goes after the manual rows instead of before them. */
    aiLast?: boolean
    /** The hint under "Create with AI", when the section has its own words for it. */
    aiHint?: string
    /**
     * The element that opens the menu, in place of the section header's "+" (for example a
     * bordered "Add automation" button). It must take a ref and spread its props (Radix `asChild`).
     */
    trigger?: ReactElement
    /** Classes for the menu panel; the default is the section "+" menu's 256 px. */
    contentClassName?: string
}

/** One row (canvas F02 f3): a plain 14 px icon, a 13 px name, a 12 px hint that wraps. */
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
        <DropdownMenuItem onSelect={onSelect} className="items-start gap-2 p-2">
            <span
                aria-hidden
                className="mt-0.5 flex shrink-0 text-colorTextSecondary [&_svg]:size-3.5"
            >
                {icon}
            </span>
            <span className="flex min-w-0 flex-col">
                <span className="text-[13px] leading-5 text-colorText">{title}</span>
                <span className="text-[12px] leading-4 text-colorTextTertiary">{hint}</span>
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
    manualItems,
    aiLast = false,
    aiHint,
    trigger,
    contentClassName = "w-64",
}: CreateWithAIAddMenuProps) {
    const t = useT(configItemsCatalog)
    const requestPrefill = useSetAtom(composerPrefillRequestAtom)
    // The menu hands focus back to its trigger as it closes. After "Create with AI" the composer
    // has to keep it, or the caret the prompt just placed is gone before the user types.
    const choseAIRef = useRef(false)
    const createWithAI = useCallback(() => {
        choseAIRef.current = true
        requestPrefill({id: Date.now(), text: starterPrompt})
    }, [requestPrefill, starterPrompt])

    const aiRow = (
        <MenuRow
            icon={<BuilderIcon size={14} />}
            title={t("entityUi.configItems.createWithAi")}
            hint={aiHint ?? t("entityUi.configItems.createWithAiHint")}
            onSelect={createWithAI}
        />
    )
    const manualRows: CreateWithAIMenuItem[] =
        manualItems ??
        (onManual
            ? [
                  {
                      key: "manual",
                      icon: manualIcon,
                      title: manualTitle ?? "",
                      hint: manualHint ?? "",
                      onSelect: onManual,
                  },
              ]
            : [])

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {trigger ?? <SectionAddButton label={label} />}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className={contentClassName}
                onCloseAutoFocus={(event) => {
                    if (!choseAIRef.current) return
                    choseAIRef.current = false
                    event.preventDefault()
                }}
            >
                {aiLast ? null : aiRow}
                {manualRows.map((item) => (
                    <MenuRow
                        key={item.key}
                        icon={item.icon}
                        title={item.title}
                        hint={item.hint}
                        onSelect={item.onSelect}
                    />
                ))}
                {aiLast ? aiRow : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
