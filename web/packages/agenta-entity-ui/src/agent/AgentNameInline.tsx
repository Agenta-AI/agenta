import {useRef, useState} from "react"

import {Input} from "@agenta/ui/ui"
import {PencilSimple} from "@phosphor-icons/react"

import {useRenameAgent} from "./useAgentActions"

export interface AgentNameInlineProps {
    /** Workflow (artifact) id — the rename target. */
    workflowId: string
    name: string
    /** Reflect a committed name back to the host (it keeps showing the live name). */
    onRenamed?: (name: string) => void
    /** Commit override. The desktop passes its app-management rename, which refreshes more caches. */
    onRename?: (id: string, name: string) => Promise<boolean>
    /** True when `name` already belongs to a different agent — blocks the commit without a modal. */
    isDuplicateName?: (name: string, selfId?: string) => boolean
}

/**
 * The agent's name in the playground header. Reads as plain text with a hover-revealed pen; click
 * the pen or double-click the name to edit inline (commit on Enter/blur, Escape cancels). Renames
 * only the name — the slug and other details are not touched here.
 */
export const AgentNameInline = ({
    workflowId,
    name,
    onRenamed,
    onRename,
    isDuplicateName,
}: AgentNameInlineProps) => {
    const renameAgent = useRenameAgent()
    const commitRename = onRename ?? renameAgent

    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(name)
    const [error, setError] = useState<string | null>(null)
    /** Escape must win the race with the blur that unmounting the field fires. */
    const cancelled = useRef(false)

    const startEditing = () => {
        setDraft(name)
        setError(null)
        cancelled.current = false
        setEditing(true)
    }

    const commit = async () => {
        if (cancelled.current) return
        const next = draft.trim()
        if (!next || next === name) {
            setEditing(false)
            return
        }
        if (isDuplicateName?.(next, workflowId)) {
            setError("An agent with this name already exists")
            return
        }
        const ok = await commitRename(workflowId, next)
        if (ok) onRenamed?.(next)
        setEditing(false)
    }

    if (editing) {
        return (
            <div className="flex min-w-0 flex-col">
                <Input
                    autoFocus
                    aria-label="Agent name"
                    value={draft}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => {
                        setDraft(e.target.value)
                        if (error) setError(null)
                    }}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault()
                            void commit()
                        } else if (e.key === "Escape") {
                            cancelled.current = true
                            setEditing(false)
                        }
                    }}
                    onFocus={(e) => e.target.select()}
                    className="h-6 w-32 text-[14px] font-[600]"
                />
                {error && <span className="mt-0.5 text-xs text-colorError">{error}</span>}
            </div>
        )
    }

    return (
        <div className="group/name flex min-w-0 items-center gap-1">
            {/* Type matches AgentPageHeader's own string branch, so the slot reads identically. */}
            <span
                className="truncate whitespace-nowrap text-sm font-[600] leading-[18px] text-colorText cursor-pointer sm:text-[16px]"
                onDoubleClick={startEditing}
                title="Double-click to rename"
            >
                {name || "Agent"}
            </span>

            {/* A real button, so the rename is reachable without a double-click. Hidden until hover
                only where there IS a hover: on touch it stays visible, as double-click never fires. */}
            <button
                type="button"
                aria-label="Rename agent"
                className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring group-hover/name:opacity-100 [@media(hover:hover)]:opacity-0"
                onClick={(e) => {
                    e.stopPropagation()
                    startEditing()
                }}
            >
                <PencilSimple size={13} />
            </button>
        </div>
    )
}
