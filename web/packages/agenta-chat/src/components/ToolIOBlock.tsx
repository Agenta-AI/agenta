/**
 * One labeled monospace payload block (tool / input / output / error) under an expanded tool row.
 *
 * Extracted from the desktop's inline `IOBlock` so both chat surfaces render a payload the same
 * way. Height-capped with its own scroller, so a megabyte of JSON can never grow the transcript —
 * and `overscroll-contain` keeps a touch scroll inside the block instead of dragging the transcript
 * with it.
 */
import {formatToolValue} from "../assets/toolFormat"

export interface ToolIOBlockProps {
    /** Row label — "tool", "input", "output", "error". */
    label: string
    /** The raw payload; pretty-printed by `formatToolValue` (fence-stripped, JSON indented). */
    value: unknown
    /** Paint it as a failure rather than a neutral payload. */
    danger?: boolean
}

export const ToolIOBlock = ({label, value, danger = false}: ToolIOBlockProps) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[12px] text-colorTextTertiary">{label}</span>
        <pre
            className={`ag-surface-inset m-0 max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-xs leading-snug ${
                danger
                    ? "!border-transparent !bg-[var(--ag-colorErrorBg)] !text-[var(--ag-colorErrorText)]"
                    : "text-colorTextSecondary"
            }`}
        >
            {formatToolValue(value)}
        </pre>
    </div>
)

export default ToolIOBlock
