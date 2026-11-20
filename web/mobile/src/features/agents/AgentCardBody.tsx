import {AgentActionsMenu, AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentsList from "@agenta/i18n/catalogs/agents.list"
import {InlineRenameInput} from "@agenta/sessions-ui"

import {lastActiveLabel, type AgentListRow} from "./agentListView"
import {AgentPrivateMarker} from "./AgentPrivateMarker"
import {AGENT_RENAME_INPUT_CLASS, useAgentInlineRename} from "./useAgentInlineRename"
import {agentMenuProps, type AgentRowActions} from "./useAgentRowActions"

/**
 * What an agent's card holds — the frame draws the tile around it.
 *
 * The same facts as the row, stacked: identity on top, three lines of description, and the
 * creator and date along the bottom, where a reader scanning cards looks last. The kebab is the
 * same shared menu, and Rename edits in place here too.
 */
export const AgentCardBody = ({
    row,
    onOpen,
    actions,
}: {
    row: AgentListRow
    /** The card's own click already does this; the menu offers it in words. */
    onOpen: (row: AgentListRow) => void
    actions: AgentRowActions
}) => {
    const t = useT(agentsList)
    const {rename, startFromMenu, handleCloseAutoFocus} = useAgentInlineRename(row)

    return (
        <>
            <span className="flex min-w-0 items-center gap-2">
                <AgentChip workflowId={row.id} />
                {rename.renaming ? (
                    <span
                        className="min-w-0 flex-1"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        <InlineRenameInput
                            rename={rename}
                            ariaLabel={t("agents.list.agentName")}
                            className={AGENT_RENAME_INPUT_CLASS}
                        />
                    </span>
                ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span
                            className="truncate text-[14px] font-medium text-foreground"
                            title={row.name}
                            onDoubleClick={(event) => {
                                event.stopPropagation()
                                rename.start()
                            }}
                        >
                            {row.name}
                        </span>
                        {row.isPrivate ? <AgentPrivateMarker /> : null}
                        {/* The same badge the row carries: without it the Status facet narrows
                            the grid to cards that say nothing about why. */}
                        {row.waiting > 0 ? (
                            <span
                                title={t("agents.list.waitingOnYou", {n: row.waiting})}
                                className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText"
                            >
                                {t("agents.list.waitingBadge", {n: row.waiting})}
                            </span>
                        ) : null}
                    </span>
                )}
                {/* The menu's own clicks are not the card's: without this every menu press
                    would also open the overview. */}
                <span
                    className="flex shrink-0 items-center"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <AgentActionsMenu
                        agent={{id: row.id, name: row.name}}
                        align="end"
                        onOpen={() => onOpen(row)}
                        onRename={startFromMenu}
                        onCloseAutoFocus={handleCloseAutoFocus}
                        {...agentMenuProps(row, actions)}
                    />
                </span>
            </span>
            <span
                className={`line-clamp-3 min-h-[3.75rem] text-[12.5px] leading-5 ${
                    row.description ? "text-muted-foreground" : "text-placeholder"
                }`}
            >
                {row.description || t("agents.list.noDescription")}
            </span>
            {/* Creator on the left, date on the right — the card's two corners, the way the
                row's columns read. */}
            <span className="mt-auto flex min-w-0 items-center gap-2 pt-1 text-[11.5px] text-placeholder">
                <span className="min-w-0 truncate">{row.ownerName || "—"}</span>
                <span className="ml-auto shrink-0">{lastActiveLabel(row.updatedAt)}</span>
            </span>
        </>
    )
}
