/**
 * sectionGroups
 *
 * Shared presentational primitives for the agent config panel's grouped sections — the triggers
 * section and the tools section render the same shapes, so they share these:
 *  - {@link SubSectionHeader}: an uppercase label + count tag ("App triggers · 3", "Connected apps · 5").
 *  - {@link ProviderLogo}: a connected-app logo (falls back to a plug glyph).
 *  - {@link CollapsibleProviderGroup}: a collapsible provider card — caret + logo + name + a count
 *    line + an optional per-group "add" button, with a `HeightCollapse` body of child rows.
 *
 * Pure presentation: state (expanded map) and data (which items belong to which provider) stay with
 * the caller. Dark-safe — antd semantic tokens (`--ag-color*`) only.
 */
import type {ReactNode} from "react"

import {HeightCollapse} from "@agenta/ui"
import {CaretDown, CaretRight, Plugs, Plus} from "@phosphor-icons/react"
import {Button, Tag, Tooltip} from "antd"
import Image from "next/image"

/** A connected-app logo square; a plug glyph when no logo is known (catalog not loaded yet). */
export function ProviderLogo({logo, size = 24}: {logo?: string | null; size?: number}) {
    if (!logo) return <Plugs size={size} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
    return (
        <Image
            src={logo}
            alt=""
            width={size}
            height={size}
            unoptimized
            className="shrink-0 rounded object-contain"
        />
    )
}

/** A sub-section label above a group of rows: uppercase text + a bordered count tag. */
export function SubSectionHeader({label, count}: {label: string; count: number}) {
    return (
        <div className="flex items-center gap-1.5 px-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
            <span>{label}</span>
            <Tag bordered className="m-0 !px-1.5 !text-[10px] font-normal leading-[16px]">
                {count}
            </Tag>
        </div>
    )
}

/**
 * A collapsible provider card: a header (caret, logo, name, right-aligned count line, optional
 * per-group add button) over a `HeightCollapse` body of child rows supplied by the caller.
 */
export function CollapsibleProviderGroup({
    logo,
    name,
    countText,
    open,
    onToggle,
    onAdd,
    addLabel,
    children,
}: {
    logo?: string | null
    name: string
    /** Right-aligned summary line, e.g. "2 active · 3 total" or "3 tools". */
    countText: string
    open: boolean
    onToggle: () => void
    /** Per-group add affordance; omit to hide the button (e.g. read-only). */
    onAdd?: () => void
    /** Tooltip + aria-label for the add button. */
    addLabel?: string
    children: ReactNode
}) {
    return (
        <div className="overflow-hidden rounded border border-solid border-[var(--ag-colorBorderSecondary)]">
            <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={onToggle}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onToggle()
                    }
                }}
                className="flex cursor-pointer items-center gap-2.5 bg-[var(--ag-colorFillQuaternary)] px-3 py-2 transition-colors hover:bg-[var(--ag-colorFillSecondary)]"
            >
                {open ? (
                    <CaretDown size={12} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
                ) : (
                    <CaretRight
                        size={12}
                        className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                    />
                )}
                <ProviderLogo logo={logo} size={24} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
                <span className="shrink-0 text-[11px] text-[var(--ag-colorTextTertiary)]">
                    {countText}
                </span>
                {onAdd ? (
                    <Tooltip title={addLabel}>
                        <Button
                            type="text"
                            icon={<Plus size={16} />}
                            aria-label={addLabel}
                            onClick={(e) => {
                                e.stopPropagation()
                                onAdd()
                            }}
                        />
                    </Tooltip>
                ) : null}
            </div>
            <HeightCollapse open={open}>
                <div className="flex flex-col gap-0.5 px-1.5 pb-1.5 pt-1">{children}</div>
            </HeightCollapse>
        </div>
    )
}
