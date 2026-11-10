/**
 * sectionGroups
 *
 * Shared presentational primitives for the agent config panel's grouped sections — the triggers
 * section and the tools section render the same shapes, so they share these:
 *  - {@link SubSectionHeader}: a quiet label + plain count ("Connected 5", "All apps 120").
 *  - {@link ProviderLogo}: a connected-app logo (falls back to a plug glyph).
 *
 * Pure presentation: state and data stay with the caller. Dark-safe — antd semantic tokens
 * (`--ag-color*`) only.
 */
import type {ReactNode} from "react"

import {CollapseCaret} from "@agenta/ui/ui"
import {Plugs} from "@phosphor-icons/react"
import Image from "next/image"

/** A connected-app logo square; a plug glyph when no logo is known (catalog not loaded yet). */
export function ProviderLogo({
    logo,
    size = 24,
    className,
}: {
    logo?: string | null
    size?: number
    /** Responsive size overrides need `!`: `size` renders as width/height attributes. */
    className?: string
}) {
    if (!logo)
        return (
            <Plugs
                size={size}
                className={`shrink-0 text-[var(--ag-colorTextSecondary)] ${className ?? ""}`}
            />
        )
    return (
        <Image
            src={logo}
            alt=""
            width={size}
            height={size}
            unoptimized
            className={`shrink-0 rounded object-contain ${className ?? ""}`}
        />
    )
}

/** A sub-section label above a group of rows: label + plain count, an optional right-aligned
 *  action, and, with `onToggle`, a caret that collapses the rows below it. */
export function SubSectionHeader({
    label,
    count,
    action,
    collapsed,
    onToggle,
}: {
    label: string
    /** Omitted while the rows load, so the header never claims a count it does not have. */
    count?: number
    action?: ReactNode
    collapsed?: boolean
    onToggle?: () => void
}) {
    const text = (
        <>
            <span>{label}</span>
            {count === undefined ? null : <span className="tabular-nums">{count}</span>}
        </>
    )
    return (
        <div className="flex items-center gap-1.5 px-0.5 text-[12px] text-[var(--ag-colorTextTertiary)]">
            {onToggle ? (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={!collapsed}
                    className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1 py-0.5 text-inherit [font:inherit] hover:text-[var(--ag-colorText)]"
                >
                    {text}
                    {/* A caret that turns shows where the rows went. */}
                    <CollapseCaret open={!collapsed} size={11} />
                </button>
            ) : (
                text
            )}
            {action ? <span className="ml-auto flex items-center">{action}</span> : null}
        </div>
    )
}
