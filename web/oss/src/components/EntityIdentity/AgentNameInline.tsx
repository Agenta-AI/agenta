import {useState} from "react"

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

    const startEditing = () => {
        setDraft(name)
        setError(null)
        setEditing(true)
    }

    const commit = async () => {
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
                    size="sm"
                    value={draft}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => {
                        setDraft(e.target.value)
                        if (error) setError(null)
                    }}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        // Let the IME keep the Enter that confirms a composition candidate
                        // (CJK, etc.) — committing there would rename to a half-typed name.
                        if (e.nativeEvent.isComposing) return
                        if (e.key === "Enter") void commit()
                        if (e.key === "Escape") setEditing(false)
                    }}
                    onFocus={(e) => e.target.select()}
                    className="!h-6 !w-32 !text-[14px] !font-[600]"
                />
                {error && <span className="mt-0.5 text-xs text-colorError">{error}</span>}
            </div>
        )
    }

    return (
        <div className="group/name flex min-w-0 items-center gap-1">
            <span
                className="truncate whitespace-nowrap text-[16px] leading-[18px] font-[600] text-colorText cursor-pointer"
                onDoubleClick={startEditing}
                title="Double-click to rename"
            >
                {name || "Agent"}
            </span>

            <PencilSimple
                size={13}
                className="shrink-0 opacity-0 transition-opacity hover:opacity-100 group-hover/name:opacity-100 cursor-pointer"
                onClick={(e) => {
                    e.stopPropagation()
                    startEditing()
                }}
            />
        </div>
    )
}

export default AgentNameInline
