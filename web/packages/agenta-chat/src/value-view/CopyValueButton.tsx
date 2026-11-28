import {useEffect, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {Button, cn} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Check, Copy} from "@phosphor-icons/react"

/** A stored value as copied text: a string as it is, anything else as indented JSON. */
export const valueAsText = (value: unknown): string =>
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value))

/**
 * An icon button that copies a value and shows a check for a moment. `label` names the button
 * ("Copy inputs"); without it, it reads "Copy value".
 */
export const CopyValueButton = ({
    value,
    className,
    label: name,
}: {
    value: unknown
    className?: string
    label?: string
}) => {
    const t = useT(valueViewCatalog)
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])
    const label = copied ? t("chat.valueView.copied") : (name ?? t("chat.valueView.copyValue"))
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            title={label}
            className={cn(copied ? "text-success" : "text-muted-foreground", className)}
            onClick={(event) => {
                event.stopPropagation()
                void copyToClipboard(valueAsText(value)).then((done) => {
                    if (!done) return
                    setCopied(true)
                    clearTimeout(timer.current)
                    timer.current = setTimeout(() => setCopied(false), 1500)
                })
            }}
        >
            {copied ? <Check size={12} /> : <Copy size={12} />}
        </Button>
    )
}
