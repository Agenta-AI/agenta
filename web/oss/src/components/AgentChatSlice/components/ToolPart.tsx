import {memo, useEffect, useState} from "react"

import {
    CaretDown,
    CaretRight,
    CheckCircle,
    Prohibit,
    Spinner,
    Warning,
    Wrench,
} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"
import {Button, Tag, Typography} from "antd"

const {Text} = Typography

/** Reveal `text` progressively (typewriter). When `enabled` is false it shows in full.
 * If `text` grows (e.g. preliminary tool-output chunks), it keeps revealing from where it
 * left off rather than restarting. */
const useTypewriter = (text: string, enabled: boolean): string => {
    const [shown, setShown] = useState(enabled ? 0 : text.length)
    useEffect(() => {
        if (!enabled) {
            setShown(text.length)
            return
        }
        let raf = 0
        const step = Math.max(4, Math.ceil(text.length / 40)) // ~40 frames regardless of size
        const tick = () => {
            setShown((s) => {
                if (s >= text.length) return s
                raf = requestAnimationFrame(tick)
                return Math.min(text.length, s + step)
            })
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [text, enabled])
    return text.slice(0, Math.min(shown, text.length))
}

// v6 tool part states → label + antd tag color. `approval-*` states only exist on the
// AI SDK v6 tool part union; the cast keeps this readable without widening the type.
const STATE_META: Record<string, {label: string; color: string}> = {
    "input-streaming": {label: "Preparing", color: "default"},
    "input-available": {label: "Running", color: "processing"},
    "approval-requested": {label: "Awaiting approval", color: "warning"},
    "approval-responded": {label: "Responded", color: "blue"},
    "output-available": {label: "Completed", color: "success"},
    "output-error": {label: "Error", color: "error"},
    "output-denied": {label: "Denied", color: "default"},
}

const JsonBlock = ({value, typewriter = false}: {value: unknown; typewriter?: boolean}) => {
    const full = typeof value === "string" ? value : JSON.stringify(value, null, 2)
    const text = useTypewriter(full, typewriter)
    return (
        <pre className="m-0 mt-1 max-h-60 max-w-full min-w-0 overflow-auto rounded bg-colorFillTertiary p-2 text-xs leading-relaxed text-colorTextSecondary">
            {text}
        </pre>
    )
}

interface ToolPartProps {
    part: ToolUIPart
    /** Resolve a pending approval. `id` is the approvalId. */
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
    disabled?: boolean
}

/**
 * Read-only renderer for a single v6 tool UI part: input → output lifecycle plus the
 * human-in-the-loop approval round-trip. The FE renders tool calls; it never executes
 * them. Approve/Deny call `addToolApprovalResponse`; the auto-resume (configured on
 * `useChat`) re-sends the conversation and the service streams the tool output.
 */
const ToolPart = ({part, onApprovalResponse, disabled}: ToolPartProps) => {
    const toolName = part.type.replace(/^tool-/, "")
    const state = part.state as string
    const meta = STATE_META[state] ?? {label: state, color: "default"}
    const approval = (part as {approval?: {id: string; approved?: boolean; reason?: string}})
        .approval

    // Collapsible body. A pending approval is force-expanded so the buttons stay reachable.
    const [open, setOpen] = useState(true)
    const isApprovalPending = state === "approval-requested"
    const expanded = isApprovalPending || open

    const StateIcon =
        state === "output-available"
            ? CheckCircle
            : state === "output-error"
              ? Warning
              : state === "output-denied"
                ? Prohibit
                : state === "input-available"
                  ? Spinner
                  : Wrench

    return (
        <div className="w-full min-w-0 overflow-hidden rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left transition-colors hover:bg-[var(--ag-rgba-051729-04)]"
            >
                {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                <StateIcon
                    size={14}
                    className={state === "input-available" ? "animate-spin" : ""}
                />
                <Text className="!text-xs font-medium">{toolName}</Text>
                <Tag color={meta.color} className="!m-0 !text-[11px]">
                    {meta.label}
                </Tag>
            </button>

            {expanded && (
                <div className="flex min-w-0 flex-col gap-2 px-3 pb-3">
                    {part.input !== undefined && (
                        <div>
                            <Text type="secondary" className="!text-[11px] uppercase tracking-wide">
                                Input
                            </Text>
                            <JsonBlock value={part.input} />
                        </div>
                    )}

                    {part.state === "output-available" && (
                        <div>
                            <Text type="secondary" className="!text-[11px] uppercase tracking-wide">
                                Output
                            </Text>
                            <JsonBlock value={part.output} typewriter />
                        </div>
                    )}

                    {part.state === "output-error" && (
                        <div>
                            <Text type="danger" className="!text-[11px] uppercase tracking-wide">
                                Error
                            </Text>
                            <JsonBlock value={part.errorText} />
                        </div>
                    )}

                    {state === "output-denied" && (
                        <Text type="secondary" className="!text-xs">
                            You denied this action; it was not executed.
                        </Text>
                    )}

                    {state === "approval-requested" && approval?.id && (
                        <div className="flex items-center gap-2 pt-1">
                            <Text className="!text-xs">Run this tool?</Text>
                            <Button
                                size="small"
                                type="primary"
                                disabled={disabled}
                                onClick={() =>
                                    onApprovalResponse({id: approval.id, approved: true})
                                }
                            >
                                Approve
                            </Button>
                            <Button
                                size="small"
                                disabled={disabled}
                                onClick={() =>
                                    onApprovalResponse({id: approval.id, approved: false})
                                }
                            >
                                Deny
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default memo(ToolPart)
