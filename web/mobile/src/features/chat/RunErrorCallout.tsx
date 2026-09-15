import {useState} from "react"

import {WarningCircle} from "@phosphor-icons/react"

import {describeRunError} from "./runError"

/**
 * A run that stopped: one sentence on the timeline's own terms — a node, a headline, the plain
 * reason — with the provider's full text behind "Details" and the retry beside it. Not a red
 * box: the failure is a step of the turn, and it reads like one.
 */
export const RunErrorCallout = ({text, onRetry}: {text: string; onRetry?: () => void}) => {
    const [open, setOpen] = useState(false)
    const error = describeRunError(text)
    return (
        <div className="flex min-w-0 items-start gap-3.5">
            <span
                aria-hidden
                className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-colorError/40 bg-colorBgContainer text-colorError"
            >
                <WarningCircle size={14} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-colorText">The run stopped</span>
                    {error.status ? (
                        <span className="font-mono text-[11px] text-colorTextTertiary">
                            {error.status}
                        </span>
                    ) : null}
                </div>
                <p className="m-0 max-w-[64ch] text-sm leading-relaxed text-colorTextSecondary">
                    {error.headline}
                </p>
                <div className="flex items-center gap-3 text-xs">
                    {onRetry ? (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="cursor-pointer border-0 bg-transparent p-0 font-medium text-colorText underline-offset-4 hover:underline"
                        >
                            Try again
                        </button>
                    ) : null}
                    {error.raw ? (
                        <button
                            type="button"
                            onClick={() => setOpen((v) => !v)}
                            aria-expanded={open}
                            className="cursor-pointer border-0 bg-transparent p-0 text-colorTextTertiary underline-offset-4 hover:underline"
                        >
                            {open ? "Hide details" : "Details"}
                        </button>
                    ) : null}
                </div>
                {open && error.raw ? (
                    <pre className="ag-surface-inset m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded px-3 py-2 font-mono text-[12px] leading-relaxed text-colorTextSecondary">
                        {error.raw}
                    </pre>
                ) : null}
            </div>
        </div>
    )
}
