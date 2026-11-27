import {useEffect, useState} from "react"

import {Button} from "@agenta/ui/ui"
import {CheckIcon, CopyIcon} from "@phosphor-icons/react"

/** MICRO-03: Copy answers in its own place (icon becomes Check), or with a note far away. */
export function CopyFeedbackDemo({inPlace}: {inPlace: boolean}) {
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const id = setTimeout(() => setCopied(false), 1500)
        return () => clearTimeout(id)
    }, [copied])
    return (
        <div className="relative flex h-24 w-full max-w-64 items-start">
            <div className="flex w-full items-center justify-between rounded-md bg-background px-3 py-2 text-code-sm shadow-[inset_0_0_0_1px_var(--border-muted)]">
                ag_live_7f3k…
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy"
                    onClick={() => setCopied(true)}
                >
                    {inPlace && copied ? <CheckIcon /> : <CopyIcon />}
                </Button>
            </div>
            {!inPlace && copied ? (
                <div className="absolute bottom-0 right-0 rounded-md bg-popover px-3 py-2 text-label shadow-overlay">
                    Copied to clipboard
                </div>
            ) : null}
        </div>
    )
}
