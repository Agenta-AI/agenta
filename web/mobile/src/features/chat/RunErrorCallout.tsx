import {useState} from "react"

import {Alert, Button} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

import {describeRunError} from "./runError"

const Details = ({raw}: {raw: string | null}) => {
    const [open, setOpen] = useState(false)
    if (!raw) return null
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorTextTertiary underline-offset-4 hover:underline"
            >
                {open ? "Hide details" : "Details"}
            </button>
            {open ? (
                <pre className="ag-surface-inset m-0 mt-1 max-h-48 w-full overflow-auto whitespace-pre-wrap break-words rounded px-3 py-2 font-mono text-[12px] leading-relaxed text-colorTextSecondary">
                    {raw}
                </pre>
            ) : null}
        </>
    )
}

/**
 * A run that stopped. Two shapes, by where it stopped:
 *
 *  - `step` — it was working and failed partway: one more node on the timeline's wire, a
 *    headline, the reason, the raw text behind Details. The failure reads like a step because
 *    it was one.
 *  - `card` — it never started (the provider refused the request before any step): there is no
 *    wire for a node to sit on, so the failure is its own small card under the message, with
 *    what to do about it and the retry as its one button.
 */
export const RunErrorCallout = ({
    text,
    onRetry,
    variant = "step",
}: {
    text: string
    onRetry?: () => void
    variant?: "step" | "card"
}) => {
    const error = describeRunError(text)

    if (variant === "card") {
        return (
            <Alert
                type="info"
                showIcon
                icon={<WarningCircle className="text-colorError" />}
                className="max-w-[520px] px-3.5 py-3"
                message="Couldn't start the run"
                description={
                    <div className="flex flex-col gap-2.5">
                        <p className="m-0 text-[13px] leading-relaxed">
                            {error.headline}
                            {error.remedy ? ` ${error.remedy}` : null}
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                            {onRetry ? (
                                <Button size="sm" variant="outline" onClick={onRetry}>
                                    Try again
                                </Button>
                            ) : null}
                            <Details raw={error.raw} />
                        </div>
                    </div>
                }
            />
        )
    }

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
                    {error.remedy ? ` ${error.remedy}` : null}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    {onRetry ? (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-colorText underline-offset-4 hover:underline"
                        >
                            Try again
                        </button>
                    ) : null}
                    <Details raw={error.raw} />
                </div>
            </div>
        </div>
    )
}
