import {FC} from "react"

import {SharedEditor} from "@agenta/editor/shared-editor"
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
                    "rounded-md bg-muted text-muted-foreground border border-solid border-border-muted px-2 py-1 text-meta",
                    className,
                )}
            >
                <span>Click run (Ctrl+Enter / ⌘+Enter) to generate output</span>
            </div>
        )
    }

    return (
        <div className={clsx("w-full rounded-md px-3 py-2.5", className)}>
            <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
                    <PlayIcon size={12} />
                </div>
                <div className="min-w-0">
                    <p className="m-0 text-meta font-medium text-muted-foreground">No output yet</p>
                    <p className="m-0 mt-0.5 text-meta text-muted-foreground">
                        Click Run (Ctrl+Enter / ⌘+Enter) to generate output.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default ResultPlaceholder
