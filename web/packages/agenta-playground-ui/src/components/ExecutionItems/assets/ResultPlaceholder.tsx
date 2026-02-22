import {FC} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import {PlayIcon} from "@phosphor-icons/react"
import clsx from "clsx"

export const ResultPlaceholder = ({message}: {message: string}) => (
    <SharedEditor initialValue={message} editorType="borderless" readOnly disabled />
)

export const RunningPlaceholder = () => <ResultPlaceholder message="Running..." />

// Visually align with TypingIndicator (same container classes) to avoid layout shift
export const ClickRunPlaceholder: FC<{className?: string; variant?: "block" | "inline"}> = ({
    className,
    variant = "block",
}) => {
    const isInline = variant === "inline"

    if (isInline) {
        return (
            <div
                className={clsx(
                    "rounded-md bg-[#fafafa] text-gray-600 border border-solid border-[rgba(5,23,41,0.06)] px-2 py-1 text-[12px] leading-4",
                    className,
                )}
            >
                <span>Click run (Ctrl+Enter / ⌘+Enter) to generate output</span>
            </div>
        )
    }

    return (
        <div
            className={clsx(
                "w-full rounded-md border border-solid border-[rgba(5,23,41,0.08)] bg-[linear-gradient(180deg,#fcfdff_0%,#f8fafc_100%)] px-3 py-2.5",
                className,
            )}
        >
            <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0517290F] text-[#344054]">
                    <PlayIcon size={12} />
                </div>
                <div className="min-w-0">
                    <p className="m-0 text-[12px] font-medium leading-4 text-[#344054]">
                        No output yet
                    </p>
                    <p className="m-0 mt-0.5 text-[12px] leading-4 text-[#667085]">
                        Click Run (Ctrl+Enter / ⌘+Enter) to generate output.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default ResultPlaceholder
