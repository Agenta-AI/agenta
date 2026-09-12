import {useCallback} from "react"

import {AgentActionsMenu, AgentChip, useRenameAgent} from "@agenta/entity-ui/agent"
import {InlineRenameInput, useDeferredMenuSelect, useInlineRename} from "@agenta/sessions-ui"

import {lastActiveLabel, NO_DESCRIPTION, type AgentListRow} from "./agentListView"

/**
 * One agent's cells, in column order.
 *
 * A component rather than a closure inside the table's `renderRow`, because a row holds state:
 * rename happens IN PLACE, the way a session row renames, so the row owns the editor and the
 * menu entry that starts it.
 */
export const AgentRowCells = ({
    row,
    narrow,
    onOpen,
}: {
    row: AgentListRow
    /** A phone has no Created by column; the cell is dropped, not hidden. */
    narrow: boolean
    /** The row's own click already does this; the menu offers it in words. */
    onOpen: (row: AgentListRow) => void
}) => {
    const renameAgent = useRenameAgent()
    const onCommit = useCallback((name: string) => renameAgent(row.id, name), [renameAgent, row.id])
    const rename = useInlineRename({
        current: row.name,
        onCommit,
        errorText: "Couldn't rename this agent",
    })
    // The editor must not mount inside the menu's focus trap — Radix would restore focus to the
    // trigger as the menu closes, and a blur commits — so the verb runs from the close instead.
    const {handleSelect, handleCloseAutoFocus} = useDeferredMenuSelect((key) => {
        if (key === "rename") return () => rename.start()
    })

    return (
        <>
            <span className="flex min-w-0 items-center gap-2">
                {/* The agent's own mark, not a generic robot — a column of identical icons
                    identifies nothing. */}
                <AgentChip workflowId={row.id} />
                {/* Tight leading and a hairline gap: the frame's own row padding is fixed and
                    shared, so the two lines are where a roster row can give height back. */}
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                    {rename.renaming ? (
                        <span
                            className="min-w-0"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                        >
                            <InlineRenameInput
                                rename={rename}
                                ariaLabel="Agent name"
                                className="h-7 w-full min-w-0 rounded-md border border-solid border-input bg-background px-2 text-[14px] leading-none text-foreground shadow-xs outline-none transition-[color,box-shadow] [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30"
                            />
                        </span>
                    ) : (
                        <span className="flex min-w-0 items-center gap-1.5">
                            <span
                                className="truncate text-[14px] font-medium leading-[18px] text-foreground"
                                title={row.name}
                                onDoubleClick={(event) => {
                                    event.stopPropagation()
                                    rename.start()
                                }}
                            >
                                {row.name}
                            </span>
                            {/* The same badge a card carries: without it the Status facet
                                narrows the list to rows that say nothing about why. */}
                            {row.waiting > 0 ? (
                                <span
                                    title={`${row.waiting} waiting on you`}
                                    className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText"
                                >
                                    {row.waiting} waiting
                                </span>
                            ) : null}
                        </span>
                    )}
                    {/* A described agent and an undescribed one have to be the same shape, or a
                        column of rows jumps height by height as you read down it. */}
                    <span
                        className={`truncate text-[13px] leading-[16px] ${
                            row.description ? "text-muted-foreground" : "text-placeholder"
                        }`}
                        title={row.description || undefined}
                    >
                        {row.description || NO_DESCRIPTION}
                    </span>
                </span>
            </span>

            {narrow ? null : (
                <span className="block truncate text-[13px] text-muted-foreground">
                    {row.ownerName || "—"}
                </span>
            )}

            <span className="block truncate text-[13px] text-placeholder">
                {lastActiveLabel(row.updatedAt)}
            </span>

            {/* The menu's own clicks are not the row's: without this every menu press would also
                open the overview. */}
            <span
                className="flex justify-end"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <AgentActionsMenu
                    agent={{id: row.id, name: row.name}}
                    align="end"
                    onOpen={() => onOpen(row)}
                    onRename={() => handleSelect("rename")}
                    onCloseAutoFocus={handleCloseAutoFocus}
                />
            </span>
        </>
    )
}
