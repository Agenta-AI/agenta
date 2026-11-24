import {useState} from "react"

import {Button} from "@agenta/ui/ui"
import {CheckIcon, CopyIcon} from "@phosphor-icons/react"

export function CodeSnippet({code}: {code: string}) {
    const [copied, setCopied] = useState(false)
    const copy = () =>
        void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
        })
    return (
        <div className="relative overflow-hidden rounded-lg bg-muted shadow-[inset_0_0_0_1px_var(--border-muted)]">
            <Button variant="ghost" size="icon-sm" aria-label="Copy code" onClick={copy} className="absolute right-1 top-1">
                {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
            <pre className="m-0 overflow-x-auto p-3 pr-10 text-code">
                <code>{code}</code>
            </pre>
        </div>
    )
}
