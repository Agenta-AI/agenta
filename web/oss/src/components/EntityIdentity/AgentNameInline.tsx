import {useRef, useState} from "react"

import {Input} from "@agenta/ui/ui"
import {PencilSimple} from "@phosphor-icons/react"

import {useRenameApp} from "./useRenameApp"

interface AgentNameInlineProps {
    /** Workflow (artifact) id — the rename target. */
    workflowId: string
    name: string
    /** Reflect a committed name back to the header (it keeps showing the live name). */
    onRenamed: (name: string) => void
}

/**
 * The agent's name in the playground header. Reads as plain text with a hover-revealed pen; click
 * the pen or double-click the name to edit inline (commit on Enter/blur, Escape cancels). Renames
 * only the name — the slug and other details are not touched here.
 */
const AgentNameInline = ({workflowId, name, onRenamed}: AgentNameInlineProps) => {
    const {renameApp, isDuplicateName} = useRenameApp()

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
        if (isDuplicateName(next, workflowId)) {
            setError("An agent with this name already exists")
            return
        }
        const ok = await renameApp({id: workflowId, name: next})
        if (ok) onRenamed(next)
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
            <span
                className="truncate whitespace-nowrap text-[16px] leading-[18px] font-[600] cursor-pointer"
                onDoubleClick={startEditing}
                title="Double-click to rename"
            >
                {name || "Agent"}
            </span>

            {/* A real button, so the rename is reachable without a double-click. */}
            <button
                type="button"
                aria-label="Rename agent"
                className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring group-hover/name:opacity-100"
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

export default AgentNameInline
