import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {timeAgo} from "@agenta/shared/utils"

import {AutomationActiveSwitch} from "./AutomationActiveSwitch"

/**
 * The facts under the name: on/off, then what it runs and when it last changed.
 *
 * `trailing` is what a phone puts beside the switch — Run now, off the crowded title row.
 *
 * No owner clause — the trigger endpoints carry only a `created_by_id`, and there is no user
 * lookup in this stack to turn that into a name, so the line stops at the agent.
 */
export const AutomationMetaRow = ({
    active,
    agentName,
    updatedAt,
    onToggle,
    trailing,
    factsOnly = false,
}: {
    active: boolean
    agentName: string | null
    updatedAt: string | null
    onToggle: (next: boolean) => Promise<void>
    trailing?: ReactNode
    /** Only the facts line, with no switch: the panel puts the switch beside the name (F05 f5). */
    factsOnly?: boolean
}) => {
    const t = useT(automationsEditorCatalog)
    const edited = updatedAt ? timeAgo(Date.parse(updatedAt)) : ""
    const facts = [
        agentName
            ? t("automations.editor.runsAgent", {agent: agentName})
            : t("automations.editor.noAgentYet"),
        edited ? t("automations.editor.edited", {time: edited}) : null,
    ]
        .filter((fact): fact is string => fact !== null)
        .join(" · ")

    if (factsOnly)
        return <span className="min-w-0 truncate text-xs text-muted-foreground">{facts}</span>

    return (
        <div className="mb-1 mt-4 flex min-w-0 flex-wrap items-center gap-3.5">
            <AutomationActiveSwitch active={active} onToggle={onToggle} />
            {trailing}
            <span className="flex min-w-0 items-center gap-3.5">
                {/* The row wraps at phone width, where a divider is either dangling at the end
                    of one line or leading the next. It only separates when both parts share a
                    line. */}
                <span aria-hidden className="hidden h-4 w-px shrink-0 bg-border sm:block" />
                <span className="min-w-0 truncate text-[13px] text-muted-foreground">{facts}</span>
            </span>
        </div>
    )
}
