import * as React from "react"

import {describeShortcut, formatChord, type Chord, type ShortcutId} from "@agenta/shared/keyboard"
import {cva, type VariantProps} from "class-variance-authority"

import {useShortcutPlatform} from "../../hooks/useShortcutPlatform"

import {cn} from "./utils"

/**
 * ShortcutHint — the keycap a control wears to advertise its own shortcut.
 *
 * Pass a catalog `id` and the keys come from the catalog, spelled for the viewer's own
 * platform. That is the whole point: the hint and the handler answering it read the same
 * definition, so they cannot drift the way a hardcoded `⌘↵` did on Windows.
 *
 * Lives here rather than beside the old copy in `RichChatInput` because that module pulls in
 * Lexical, which put the hint out of reach of every surface that is not the composer.
 */
const keycapVariants = cva(
    [
        // CONTROL_RESET — see button.tsx (preflight is off app-wide for antd's sake).
        "box-border",
        "inline-flex items-center justify-center whitespace-nowrap font-medium leading-none",
        "text-[var(--ag-colorTextSecondary)]",
    ],
    {
        variants: {
            size: {
                sm: "ag-surface-chip rounded px-1 py-0.5 font-[inherit] text-[12px]",
                xs: "h-[15px] min-w-[15px] rounded-[3px] bg-[var(--ag-colorFillTertiary)] px-1 font-mono text-[9.5px]",
            },
        },
        defaultVariants: {size: "sm"},
    },
)

export interface ShortcutHintProps
    extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof keycapVariants> {
    /** The catalog entry to advertise. Supplies both the keys and the label. */
    id?: ShortcutId
    /** An explicit chord, for a control with no catalog entry yet. */
    chord?: Chord
    /** Pre-formatted keys, for a hint the catalog does not own (a `/` trigger, say). */
    keys?: string
    /** Overrides the catalog's label; pass `null` to render the keycap alone. */
    label?: React.ReactNode | null
}

export function ShortcutHint({
    id,
    chord,
    keys,
    label,
    size,
    className,
    ...props
}: ShortcutHintProps) {
    const {isMac} = useShortcutPlatform()
    const listing = id ? describeShortcut(id, {isMac}) : null

    const rendered = keys ?? (chord ? formatChord(chord, {isMac}) : listing?.chords[0])
    if (!rendered) return null

    const text = label === undefined ? listing?.label : label

    return (
        <span
            className={cn(
                "flex items-center gap-1 whitespace-nowrap text-[12px] text-[var(--ag-colorTextSecondary)]",
                size === "xs" && "gap-[5px]",
                className,
            )}
            {...props}
        >
            <kbd className={keycapVariants({size})}>{rendered}</kbd>
            {text}
        </span>
    )
}
