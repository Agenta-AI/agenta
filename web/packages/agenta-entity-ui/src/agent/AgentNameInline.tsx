import {useRef, useState, type ElementType} from "react"

import {Input} from "@agenta/ui/ui"
import {PencilSimple} from "@phosphor-icons/react"

import {AGENT_FOCUS_RING} from "./chrome"
import {useRenameAgent} from "./useAgentActions"

/** `bar` is the playground header's rung; `title` the page-heading one every /m screen title uses. */
export type AgentNameSize = "bar" | "title"

const NAME_SIZE: Record<AgentNameSize, {label: string; input: string}> = {
    bar: {
        label: "text-sm font-[600] leading-[18px] sm:text-[16px]",
        input: "h-6 w-32 text-[14px] font-[600]",
    },
    title: {
        label: "text-[24px] font-semibold leading-[1.3333333333333333]",
        input: "h-8 w-48 text-[20px] font-semibold",
    },
}

/** The label's classes on their own, for a host that shows the name without the rename affordance. */
export const agentNameLabelClass = (size: AgentNameSize = "bar") =>
    `m-0 min-w-0 truncate whitespace-nowrap text-colorText ${NAME_SIZE[size].label}`

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
    /** Type rung. */
    size?: AgentNameSize
    /** Element for the label — a page title needs a heading, the playground bar a span. */
    as?: ElementType
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
    size = "bar",
    as: Label = "span",
}: AgentNameInlineProps) => {
    const renameAgent = useRenameAgent()
    const commitRename = onRename ?? renameAgent

    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(name)
    const [error, setError] = useState<string | null>(null)
    /** Escape must win the race with the blur that unmounting the field fires. */
    const cancelled = useRef(false)
    /** Enter then blur both commit; two in flight can resolve out of order and undo the later name. */
    const committing = useRef(false)

    const startEditing = () => {
        setDraft(name)
        setError(null)
        cancelled.current = false
        setEditing(true)
    }

    const commit = async () => {
        if (cancelled.current || committing.current) return
        const next = draft.trim()
        if (!next || next === name) {
            setEditing(false)
            return
        }
        if (isDuplicateName?.(next, workflowId)) {
            setError("An agent with this name already exists")
            return
        }
        committing.current = true
        try {
            const ok = await commitRename(workflowId, next)
            if (ok) onRenamed?.(next)
        } finally {
            committing.current = false
        }
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
                    className={NAME_SIZE[size].input}
                />
                {error && <span className="mt-0.5 text-xs text-colorError">{error}</span>}
            </div>
        )
    }

    return (
        <div className="group/name flex min-w-0 items-center gap-1">
            {/* At `bar` the type matches AgentPageHeader's own string branch, so the slot reads
                identically. */}
            <Label
                className={`${agentNameLabelClass(size)} cursor-pointer`}
                onDoubleClick={startEditing}
                title="Double-click to rename"
            >
                {name || "Agent"}
            </Label>

            {/* A real button, so the rename is reachable without a double-click. Hidden until hover
                only where there IS a hover: on touch it stays visible, as double-click never fires. */}
            {/* Transparent ::after hit extender: a ~31px touch target around the 13px glyph. */}
            <button
                type="button"
                aria-label="Rename agent"
                className={`relative flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 opacity-60 transition-opacity after:absolute after:inset-[-9px] after:content-[''] hover:opacity-100 focus-visible:opacity-100 group-hover/name:opacity-100 [@media(hover:hover)]:opacity-0 ${AGENT_FOCUS_RING}`}
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
