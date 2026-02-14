import {FC} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import clsx from "clsx"

export const ResultPlaceholder = ({message}: {message: string}) => (
    <SharedEditor initialValue={message} editorType="borderless" readOnly disabled />
)

export const RunningPlaceholder = () => <ResultPlaceholder message="Running..." />

// Visually align with TypingIndicator (same container classes) to avoid layout shift
export const ClickRunPlaceholder: FC<{className?: string}> = ({className}) => {
    return (
        <div
            className={clsx(
                "w-full px-3 py-2 rounded-md bg-[#fafafa] text-[13px] text-gray-600 border border-solid border-[rgba(5,23,41,0.06)]",
                className,
            )}
        >
            <span>Click run (Ctrl+Enter / ⌘+Enter) to generate output</span>
        </div>
    )
}

export default ResultPlaceholder
