/**
 * Keycaps for one keyboard shortcut, printed the way the reader's own keyboard is labelled.
 *
 * The platform answer arrives after mount, never during render: the server has no platform, and
 * guessing one mismatches on hydration. Until it lands, the component prints the non-Apple faces,
 * which is what `isMacPlatform()` already returns server-side.
 */
import {useEffect, useState} from "react"

import {
    getShortcut,
    isMacPlatform,
    shortcutFaces,
    type Shortcut,
    type ShortcutModifier,
} from "@agenta/shared/utils"

import {cn} from "../components/ui/utils"

export interface ShortcutKeysProps {
    /** The registry id, e.g. `session.new`. Ignored when `chord` is given. */
    id?: string
    /** An explicit chord, for a binding that is not in the registry. */
    chord?: {modifiers?: ShortcutModifier[]; key: string}
    /** Also print the shortcut's mirror chord, e.g. `Alt Z` and `Alt X`. */
    showAlt?: boolean
    /** `chip` sits on a surface; `inverse` sits inside a dark tooltip or a filled button. */
    tone?: "chip" | "inverse"
    size?: "sm" | "md"
    /** Hide from assistive tech where an adjacent label already names the action. */
    "aria-hidden"?: boolean
    className?: string
}

const capBase =
    "inline-flex items-center justify-center rounded font-medium leading-none whitespace-nowrap"

const capTone = {
    chip: "ag-surface-chip text-[var(--ag-colorTextSecondary)]",
    inverse: "bg-white/20 text-inherit",
} as const

const capSize = {
    sm: "min-w-4 px-1 py-0.5 text-[11px]",
    md: "min-w-5 px-1.5 py-1 text-[12px]",
} as const

/** Reads the platform once on mount. Exported so a parent can print many caps from one read. */
export const useIsMacPlatform = (): boolean => {
    const [mac, setMac] = useState(false)
    useEffect(() => setMac(isMacPlatform()), [])
    return mac
}

const Caps = ({
    faces,
    tone,
    size,
}: {
    faces: string[]
    tone: keyof typeof capTone
    size: keyof typeof capSize
}) => (
    <>
        {faces.map((face, index) => (
            <kbd key={`${face}-${index}`} className={cn(capBase, capTone[tone], capSize[size])}>
                {face}
            </kbd>
        ))}
    </>
)

export const ShortcutKeys = ({
    id,
    chord,
    showAlt = false,
    tone = "chip",
    size = "sm",
    "aria-hidden": ariaHidden,
    className,
}: ShortcutKeysProps) => {
    const mac = useIsMacPlatform()
    const shortcut: Shortcut | undefined = id ? getShortcut(id) : undefined
    const primary =
        chord ?? (shortcut ? {modifiers: shortcut.modifiers, key: shortcut.key} : undefined)
    if (!primary) return null

    // An explicit chord stands alone: borrowing a mirror from `id` would print a key it never named.
    const mirror = showAlt && !chord ? shortcut?.alt : undefined

    return (
        <span
            aria-hidden={ariaHidden}
            className={cn("inline-flex items-center gap-1 align-middle", className)}
        >
            <Caps faces={shortcutFaces(primary, mac)} tone={tone} size={size} />
            {mirror ? (
                <>
                    <span className="text-[var(--ag-colorTextSecondary)] opacity-50">/</span>
                    <Caps faces={shortcutFaces(mirror, mac)} tone={tone} size={size} />
                </>
            ) : null}
        </span>
    )
}
