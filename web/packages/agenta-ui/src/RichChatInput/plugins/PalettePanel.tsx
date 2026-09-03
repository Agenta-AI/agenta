/**
 * The floating palette panel — presentation only, so both the `/` command menu and the `@` file
 * menu paint identically and a story can drive every state without Lexical.
 */
import type {CSSProperties, ReactNode, RefObject} from "react"

import {CaretRight} from "@phosphor-icons/react"
import clsx from "clsx"

import {matchLabel, type PaletteItem, type PaletteSection} from "../assets/palette"

export interface PalettePanelProps {
    listId: string
    label: string
    query: string
    sections: PaletteSection[]
    activeIndex: number
    activeRowRef: RefObject<HTMLDivElement | null>
    optionId: (index: number) => string
    onHover: (index: number) => void
    onSelect: (item: PaletteItem) => void
    onDrillIn: (item: PaletteItem) => void
    header?: ReactNode
    footer?: ReactNode
    loading?: boolean
    emptyText?: ReactNode
    floatingRef: (node: HTMLElement | null) => void
    floatingStyles: CSSProperties
}

export function PalettePanel({
    listId,
    label,
    query,
    sections,
    activeIndex,
    activeRowRef,
    optionId,
    onHover,
    onSelect,
    onDrillIn,
    header,
    footer,
    loading,
    emptyText,
    floatingRef,
    floatingStyles,
}: PalettePanelProps) {
    let rowIndex = -1
    const isEmpty = sections.every((section) => section.items.length === 0)

    return (
        <div
            ref={floatingRef}
            id={listId}
            style={floatingStyles}
            role="listbox"
            aria-label={label}
            // font-portal: portaled to <body>, escaping the app font scope (preflight off).
            // box-border for the same reason: `size()` sets the ANCHOR's width, and with no
            // preflight reset the default content-box would add the 1px borders on top, leaving the
            // menu wider than the composer and nudged off-anchor by `shift`.
            className="z-[1050] box-border overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] font-portal shadow-overlay"
        >
            {header ? (
                <div className="flex items-center gap-2 border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] px-[15px] py-[9px] text-xs text-[var(--ag-colorText)]">
                    {header}
                </div>
            ) : null}
            {/* ~8 rows: enough to browse a level, short enough to leave the transcript readable. */}
            <div className="max-h-[220px] overflow-y-auto pb-1">
                {isEmpty && loading ? (
                    <ShimmerRows />
                ) : isEmpty ? (
                    <div className="px-4 py-[26px] text-center">
                        <div className="text-xs text-[var(--ag-colorTextSecondary)]">
                            {emptyText ?? `No match for “${query}”`}
                        </div>
                    </div>
                ) : (
                    sections.map((section) => (
                        <div key={section.key}>
                            {section.title ? (
                                <div className="px-[15px] pb-[5px] pt-[10px] text-[9.5px] font-medium uppercase leading-none tracking-[.1em] text-[var(--ag-colorTextTertiary)]">
                                    {section.title}
                                </div>
                            ) : null}
                            {section.items.map((item) => {
                                rowIndex += 1
                                const index = rowIndex
                                const active = index === activeIndex
                                return (
                                    <PaletteRow
                                        key={item.key}
                                        item={item}
                                        id={optionId(index)}
                                        active={active}
                                        rowRef={active ? activeRowRef : undefined}
                                        query={query}
                                        onHover={() => onHover(index)}
                                        onSelect={() => onSelect(item)}
                                        onDrillIn={() => onDrillIn(item)}
                                    />
                                )
                            })}
                        </div>
                    ))
                )}
                {/* Rows are already listed, but a deeper level is still arriving. */}
                {!isEmpty && loading ? <ShimmerRows rows={2} /> : null}
            </div>
            {footer ? (
                <div className="flex items-center gap-4 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-[13px] py-[7px] text-[10.5px] text-[var(--ag-colorTextTertiary)]">
                    {footer}
                </div>
            ) : null}
        </div>
    )
}

const SHIMMER_WIDTHS = ["52%", "38%", "61%"]

function ShimmerRows({rows = 3}: {rows?: number}) {
    return (
        <>
            {SHIMMER_WIDTHS.slice(0, rows).map((width) => (
                <div key={width} className="flex items-center gap-2.5 px-[15px] py-[7px]">
                    <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-[var(--ag-colorFillSecondary)]" />
                    <span
                        className="h-2.5 animate-pulse rounded bg-[var(--ag-colorFillSecondary)]"
                        style={{width}}
                    />
                </div>
            ))}
        </>
    )
}

function PaletteRow({
    item,
    id,
    active,
    rowRef,
    query,
    onHover,
    onSelect,
    onDrillIn,
}: {
    item: PaletteItem
    id: string
    active: boolean
    rowRef?: RefObject<HTMLDivElement | null>
    query: string
    onHover: () => void
    onSelect: () => void
    onDrillIn: () => void
}) {
    const parts = matchLabel(item.label, query)
    return (
        <div
            id={id}
            ref={rowRef}
            role="option"
            // The palette has no value in effect, so — unlike the pickers it opens — the cursor IS
            // the selection candidate.
            aria-selected={active}
            onMouseEnter={onHover}
            // mousedown, not click: the editor must not lose the caret before the selection runs.
            onMouseDown={(e) => {
                e.preventDefault()
                onSelect()
            }}
            className={clsx(
                "mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-md px-[9px] py-1.5",
                active && "bg-[var(--ag-colorFillTertiary)]",
            )}
        >
            {/* No reserved slot when nothing supplies an icon — an empty one just reads as a
                ragged left margin. */}
            {item.icon ? (
                <span
                    className={clsx(
                        "flex w-4 shrink-0 justify-start",
                        active
                            ? "text-[var(--ag-colorTextSecondary)]"
                            : "text-[var(--ag-colorTextDisabled)]",
                    )}
                >
                    {item.icon}
                </span>
            ) : null}
            <span className="whitespace-nowrap font-mono text-[12.5px] font-medium leading-tight text-[var(--ag-colorText)]">
                {parts ? (
                    <>
                        {parts.before}
                        {parts.match ? (
                            // A primary tint, not colorInfoBg — that token sits within a hair of
                            // the row background, so the match read as unmarked.
                            <span className="rounded-[2px] bg-[color-mix(in_srgb,var(--ag-colorPrimary)_22%,transparent)]">
                                {parts.match}
                            </span>
                        ) : null}
                        {parts.after}
                    </>
                ) : (
                    item.label
                )}
            </span>
            {item.secondary ? (
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-[var(--ag-colorTextTertiary)]">
                    {item.secondary}
                </span>
            ) : null}
            {item.description ? (
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-[var(--ag-colorTextTertiary)]">
                    {item.description}
                </span>
            ) : null}
            {item.badge ? <span className="shrink-0">{item.badge}</span> : null}
            {item.onDrillIn ? (
                // A real target, because a touch screen has no Tab. stopPropagation keeps the tap
                // off the row's own reference action.
                <button
                    type="button"
                    aria-label={`Open ${item.label}`}
                    onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onDrillIn()
                    }}
                    className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded border-0 bg-transparent pl-2.5 text-[10px] text-[var(--ag-colorTextTertiary)]"
                >
                    {item.tail}
                    <CaretRight size={11} />
                </button>
            ) : item.tail ? (
                <span className="ml-auto whitespace-nowrap pl-2.5 text-[10px] text-[var(--ag-colorTextTertiary)]">
                    {item.tail}
                </span>
            ) : null}
        </div>
    )
}

/** One `key + label` footer hint, e.g. `↵ reference`. */
export function HintKey({keys, label}: {keys: string; label: string}) {
    return (
        <span className="flex items-center gap-[5px]">
            <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[3px] bg-[var(--ag-colorFillTertiary)] px-1 font-mono text-[9.5px] font-medium text-[var(--ag-colorTextSecondary)]">
                {keys}
            </span>
            {label}
        </span>
    )
}
