/**
 * ResponseFormatControl
 *
 * Schema-driven control for response format selection with JSON schema editing.
 * Supports three modes:
 * - text (default): No structured output
 * - json_object: JSON mode (LLM returns valid JSON)
 * - json_schema: Structured output with user-defined JSON schema
 *
 * Architecture:
 * - Container: reads/writes `responseFormatModalOpenAtom` (which control's modal is open)
 * - Presentational: `ResponseFormatControlView` — all markup, plain props, zero jotai
 */

import {memo, useCallback} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import type {ButtonProps} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom, type PrimitiveAtom} from "jotai"
import {atomWithReset} from "jotai/utils"

import {ResponseFormatControlView, type ResponseFormatValue} from "./ResponseFormatControlView"

export type {ResponseFormatValue} from "./ResponseFormatControlView"
export {ResponseFormatControlView} from "./ResponseFormatControlView"
export type {ResponseFormatControlViewProps} from "./ResponseFormatControlView"

export interface ResponseFormatControlProps {
    /** Unique identifier for this control instance (typically entityId) */
    controlId: string
    /** The schema property (optional, for future validation) */
    schema?: SchemaProperty | null
    /** Current value */
    value: ResponseFormatValue | null | undefined
    /** Change handler */
    onChange: (value: ResponseFormatValue) => void
    /** Disable the control */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /** Size variant — `@agenta/ui` vocabulary (`sm`/`default`/…), not antd's small/middle. */
    size?: ButtonProps["size"]
}

/**
 * Atom tracking which ResponseFormatControl's modal is currently open.
 * Value is the controlId of the open modal, or null if none is open.
 *
 * This replaces useEffect-based modal opening with explicit state management.
 */
export const responseFormatModalOpenAtom: PrimitiveAtom<string | null> = atomWithReset<
    string | null
>(null)

/**
 * ResponseFormatControl container.
 *
 * @example
 * ```tsx
 * <ResponseFormatControl
 *   controlId={entityId}
 *   value={responseFormat}
 *   onChange={(v) => dispatch({type: 'updateResponseFormat', value: v})}
 * />
 * ```
 */
export const ResponseFormatControl = memo(function ResponseFormatControl({
    controlId,
    schema: _schema,
    value,
    onChange,
    disabled = false,
    className,
    size,
}: ResponseFormatControlProps) {
    // Modal state from atom - use separate read/write hooks for better type inference
    const openModalId = useAtomValue(responseFormatModalOpenAtom)
    const setOpenModalId = useSetAtom(responseFormatModalOpenAtom)

    const handleOpenChange = useCallback(
        (next: boolean) => setOpenModalId(next ? controlId : null),
        [setOpenModalId, controlId],
    )

    return (
        <ResponseFormatControlView
            value={value}
            onChange={onChange}
            disabled={disabled}
            className={className}
            size={size}
            open={openModalId === controlId}
            onOpenChange={handleOpenChange}
        />
    )
})
