import {useEffect, useState} from "react"

import {Button} from "@agenta/ui/ui"
import {Check, Copy} from "@phosphor-icons/react"

export interface CodeBlockProps {
    /** Shown in the header, e.g. a file name. */
    label: string
    code: string
    /** Wrap long lines instead of scrolling sideways. */
    wrap?: boolean
    /** The body's height cap, as a Tailwind class. */
    maxHeightClass?: string
    "data-testid"?: string
}

/** Read-only code with a header (label and Copy) and a thin, hover-only scrollbar. */
export const CodeBlock = ({
    label,
    code,
    wrap = false,
    maxHeightClass = "max-h-64",
    "data-testid": testId,
}: CodeBlockProps) => {
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), 1800)
        return () => clearTimeout(timer)
    }, [copied])

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
        } catch {
            /* the code stays on screen to select by hand */
        }
    }

    return (
        <div className="min-w-0 overflow-hidden rounded-lg border border-solid border-border">
            <div className="flex items-center justify-between border-0 border-b border-solid border-border bg-muted py-1.5 pl-3 pr-2 text-xs text-muted-foreground">
                {label}
                <Button variant="ghost" size="xs" onClick={() => void copy()}>
                    {copied ? (
                        <Check weight="bold" data-icon="inline-start" />
                    ) : (
                        <Copy data-icon="inline-start" />
                    )}
                    {copied ? "Copied" : "Copy"}
                </Button>
            </div>
            {/* The scroll sits on a div: a global rule gives every <pre> a wide scrollbar. */}
            <div className={`ag-scroll-quiet overflow-auto ${maxHeightClass}`}>
                <pre
                    className={`m-0 p-3 font-mono text-xs leading-relaxed text-foreground ${
                        wrap ? "whitespace-pre-wrap" : "w-max min-w-full whitespace-pre"
                    }`}
                    data-testid={testId}
                >
                    {code}
                </pre>
            </div>
        </div>
    )
}
