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
import {
    Badge,
    Button,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {CaretDown, CaretRight, Plugs, Plus} from "@phosphor-icons/react"
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

/** A sub-section label above a group of rows: uppercase text + a bordered count tag, and an
 *  optional right-aligned action (the integrations header carries its own add button). */
export function SubSectionHeader({
    label,
    count,
    action,
}: {
    label: string
    count: number
    action?: ReactNode
}) {
    return (
        <div className="flex items-center gap-1.5 px-0.5 text-[12px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
            <span>{label}</span>
            {/* antd v6 `bordered` (truthy) is a no-op; colourless Tag == Badge `default`. */}
            <Badge className="m-0 px-1.5 text-[12px] font-normal leading-4">{count}</Badge>
            {action ? <span className="ml-auto flex items-center">{action}</span> : null}
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
    statusTag,
    children,
}: {
    logo?: string | null
    name: string
    /** Right-aligned summary line, e.g. "2 active · 3 total" or "3 tools"; omit to hide it. */
    countText?: string
    open: boolean
    onToggle: () => void
    /** Per-group add affordance; omit to hide the button (e.g. read-only). */
    onAdd?: () => void
    /** Tooltip + aria-label for the add button. */
    addLabel?: string
    /** Rollup status tag rendered after the name (e.g. the worst child-row status). */
    statusTag?: ReactNode
    children: ReactNode
}) {
    return (
        // White sheet on the expanded section's band; the header keeps its own fill on top.
        <div className="overflow-hidden rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-surface-section-content)]">
            {/* Header stays clickable but is not the role=button node — it holds the + button
                (nested-interactive). The role lives on the name span below. */}
            <div
                onClick={onToggle}
                // pr = section header's caret gutter (14px caret + 8px gap) minus the card border,
                // so the group's + button sits in the same column as the section header's +.
                className="flex cursor-pointer items-center gap-2.5 bg-[var(--ag-colorFillQuaternary)] py-2 pl-3 pr-[21px] transition-colors hover:bg-[var(--ag-colorFillSecondary)]"
            >
                {open ? (
                    <CaretDown size={12} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
                ) : (
                    <CaretRight
                        size={12}
                        className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                    />
                )}
                <ProviderLogo logo={logo} size={20} />
                <span
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onToggle()
                        }
                    }}
                    className="min-w-0 flex-1 truncate text-xs font-medium"
                >
                    {name}
                </span>
                {statusTag ? <span className="shrink-0">{statusTag}</span> : null}
                {countText ? (
                    <span className="shrink-0 text-xs text-[var(--ag-colorTextTertiary)]">
                        {countText}
                    </span>
                ) : null}
                {onAdd ? (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={addLabel}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onAdd()
                                    }}
                                >
                                    <Plus size={16} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{addLabel}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : null}
            </div>
            <HeightCollapse open={open}>
                <div className="flex flex-col gap-0.5 px-1.5 pb-1.5 pt-1">{children}</div>
            </HeightCollapse>
        </div>
    )
}
