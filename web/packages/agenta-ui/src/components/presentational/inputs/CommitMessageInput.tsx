/**
 * CommitMessageInput Component
 *
 * A labeled textarea for commit/deploy/revert messages with character count.
 * Shared across entity commit modals, deploy modals, and other flows
 * that need a note/message textarea.
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

import {Input, Typography} from "antd"

import {cn, textColors} from "../../../utils/styles"

const {TextArea} = Input
const {Text} = Typography

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
}: CommitMessageInputProps) {
    return (
        <div className={cn("flex flex-col gap-1", className)}>
            <Text className="font-medium">
                {label}
                {showOptional && (
                    <>
                        {" "}
                        <span className={textColors.quaternary}>(optional)</span>
                    </>
                )}
            </Text>
            <TextArea
                placeholder={placeholder}
                className="w-full"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoSize={{minRows, maxRows}}
                showCount
                maxLength={maxLength}
                disabled={disabled}
                autoFocus={autoFocus}
            />
        </div>
    )
})

export default CommitMessageInput
