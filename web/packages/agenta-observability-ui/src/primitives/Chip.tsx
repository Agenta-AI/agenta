import type {ReactNode} from "react"

import {cn} from "@agenta/ui/styles"

export type ChipTone = "success" | "error" | "neutral"

const TONE_CLASSES: Record<ChipTone, string> = {
    success:
        "bg-[var(--ag-colorSuccessBg)] text-[var(--ag-colorSuccessText)] border-[var(--ag-colorSuccessBorder)]",
    error: "bg-[var(--ag-colorErrorBg)] text-[var(--ag-colorErrorText)] border-[var(--ag-colorErrorBorder)]",
    neutral: "bg-[var(--ag-colorFillTertiary)] text-[var(--ag-colorText)] border-transparent",
}

interface ChipProps {
    tone?: ChipTone
    icon?: ReactNode
    className?: string
    children: ReactNode
}

/** antd `Tag` replacement — a plain span on semantic tokens. */
export const Chip = ({tone = "neutral", icon, className, children}: ChipProps) => (
    <span
        className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-[1px] text-xs border border-solid box-border",
            TONE_CLASSES[tone],
            className,
        )}
    >
        {icon}
        {children}
    </span>
)
