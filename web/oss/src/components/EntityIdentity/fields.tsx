import {type ReactNode, useState} from "react"

import {Check, Copy} from "@phosphor-icons/react"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

/** Field caption shared by the rename modal and the identity cards, so the two read the same. */
export const FieldLabel = ({children}: {children: ReactNode}) => (
    <div className="mb-1.5 text-[12px] font-semibold text-colorTextSecondary">{children}</div>
)

/** Read-only value in a filled row with a copy affordance (no toast — a brief check flash). */
export const CopyRow = ({value, label}: {value: string; label: string}) => {
    const [copied, setCopied] = useState(false)
    const onCopy = () => {
        copyToClipboard(value, false)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
    }
    return (
        <div className="flex items-center gap-2 rounded-lg border border-solid border-colorBorder bg-colorFillQuaternary px-2.5 py-1.5">
            <span className="flex-1 truncate font-mono text-[11.5px] text-colorTextSecondary">
                {value}
            </span>
            <button
                type="button"
                aria-label={label}
                onClick={onCopy}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-solid border-colorBorder bg-colorBgContainer text-colorTextSecondary transition-colors hover:border-colorBorderSecondary hover:text-colorText"
            >
                {copied ? <Check size={14} /> : <Copy size={13} />}
            </button>
        </div>
    )
}

/** Kind pill (Agent / Chat / …) — the same badge the rename modal header shows. */
export const TypeBadge = ({label}: {label: string}) => (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-colorFillTertiary px-2 py-0.5 text-[11px] font-medium text-[var(--ag-c-13C2C2)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--ag-c-13C2C2)]" />
        {label}
    </span>
)
