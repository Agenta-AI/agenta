import {useEffect, useRef, useState} from "react"

import {Button} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Check, Copy} from "@phosphor-icons/react"

/** An icon button that copies a section of the test case as JSON, with a check for a moment. */
export const ScenarioFocusCopyButton = ({value, label}: {value: unknown; label: string}) => {
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])
    return (
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            className={copied ? "text-success" : "text-muted-foreground"}
            onClick={async () => {
                const text =
                    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "")
                if (!(await copyToClipboard(text))) return
                setCopied(true)
                clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopied(false), 1500)
            }}
        >
            {copied ? <Check /> : <Copy />}
        </Button>
    )
}
