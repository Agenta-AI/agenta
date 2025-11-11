import {ReactNode} from "react"

import clsx from "clsx"

export type PlaceholderEvaluationType = "online" | "auto" | "human"

interface PlaceholderOverlayProps {
    className?: string
    evaluationType?: PlaceholderEvaluationType
    title?: ReactNode
    description?: ReactNode
    children?: ReactNode
}

const DEFAULT_COPY: Record<PlaceholderEvaluationType, {title: string; description: string}> = {
    online: {
        title: "Waiting for your traces",
        description: "Generate traces to start collecting results.",
    },
    auto: {
        title: "Waiting for evaluation runs",
        description: "Run your prompt against testcases to start collecting metrics.",
    },
    human: {
        title: "Waiting for evaluation runs",
        description: "Run your prompt against testcases to start collecting metrics.",
    },
}

const PlaceholderOverlay = ({
    className,
    evaluationType = "online",
    title,
    description,
    children,
}: PlaceholderOverlayProps) => {
    const copy = DEFAULT_COPY[evaluationType] ?? DEFAULT_COPY.online
    const resolvedTitle = title ?? copy.title
    const resolvedDescription = description ?? copy.description

    return (
        <div
            className={clsx(
                "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-white/30 px-6 text-center text-[#1D2939] backdrop-blur-sm",
                className,
            )}
        >
            {children ?? (
                <>
                    <span className="text-sm font-medium">{resolvedTitle}</span>
                    <span className="text-xs text-[#667085]">{resolvedDescription}</span>
                </>
            )}
        </div>
    )
}

export default PlaceholderOverlay
