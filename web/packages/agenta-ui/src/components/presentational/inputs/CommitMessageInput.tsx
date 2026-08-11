/**
 * CommitMessageInput Component
 *
 * A labeled textarea for commit/deploy/revert messages with character count.
 * Shared across entity commit modals, deploy modals, and other flows
 * that need a note/message textarea. The label is owned by the `Field` primitive
 * (no hand-rolled label markup / raw antd Typography).
 *
 * @example
 * ```tsx
 * import { CommitMessageInput } from '@agenta/ui'
 *
 * <CommitMessageInput value={note} onChange={setNote} />
 * <CommitMessageInput value={note} onChange={setNote} label="Deploy message" />
 * ```
 */

import {memo} from "react"

import {cn, textColors} from "../../../utils/styles"
import {Field} from "../../ui/field"
import {AutosizeTextarea} from "../../ui/input-composed"

/** Default max length for commit/deploy messages */
export const COMMIT_MESSAGE_MAX_LENGTH = 500

export interface CommitMessageInputProps {
    /** Current message value */
    value: string
    /** Change handler */
    onChange: (value: string) => void
    /** Label text (default: "Notes") */
    label?: string | React.ReactNode
    /** Whether the label shows "(optional)" suffix (default: true) */
    showOptional?: boolean
    /** Placeholder text */
    placeholder?: string
    /** Max character length (default: 500) */
    maxLength?: number
    /** Min rows for autosize (default: 2) */
    minRows?: number
    /** Max rows for autosize (default: 4) */
    maxRows?: number
    /** Whether the input is disabled */
    disabled?: boolean
    /** Whether to auto-focus the textarea */
    autoFocus?: boolean
    /** Additional class name for the wrapper */
    className?: string
    /**
     * When true, the textarea stretches to fill the available height of its (flex) parent
     * instead of auto-sizing to content. The wrapper must be given a bounded height.
     */
    fill?: boolean
}

export const CommitMessageInput = memo(function CommitMessageInput({
    value,
    onChange,
    label = "Notes",
    showOptional = true,
    placeholder = "Add a brief summary of what changed",
    maxLength = COMMIT_MESSAGE_MAX_LENGTH,
    minRows = 2,
    maxRows = 4,
    disabled = false,
    autoFocus = false,
    className,
    fill = false,
}: CommitMessageInputProps) {
    const labelNode = (
        <>
            {label}
            {showOptional && (
                <>
                    {" "}
                    <span className={textColors.quaternary}>(optional)</span>
                </>
            )}
        </>
    )

    return (
        <Field label={labelNode} className={cn(fill && "min-h-0 flex-1", className)}>
            <div className={cn("relative flex flex-col", fill && "min-h-0 flex-1")}>
                <AutosizeTextarea
                    placeholder={placeholder}
                    className={cn("w-full", fill && "h-full min-h-0 flex-1 resize-none")}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    autoSize={fill ? false : {minRows, maxRows}}
                    maxLength={maxLength}
                    disabled={disabled}
                    autoFocus={autoFocus}
                />
                {/* Reproduces antd `showCount`'s `.ant-input-data-count`: end-aligned, 12px,
                    colorTextDescription. It was 10px/quaternary, which the parity gate caught. */}
                <span className={cn("self-end pt-0.5 text-xs", textColors.description)}>
                    {value?.length ?? 0} / {maxLength}
                </span>
            </div>
        </Field>
    )
})

export default CommitMessageInput
