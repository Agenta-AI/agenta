import type {ReactNode} from "react"

import {Plus, X} from "@phosphor-icons/react"
import {Button, Spin, Typography} from "antd"

// Draft list ids are prefixed so they're distinguishable from real entity ids.
export const DRAFT_PREFIX = "draft:"
export const isDraftId = (id?: string): id is string => !!id && id.startsWith(DRAFT_PREFIX)

// Hover-revealed remove affordance: a real <button> (keyboard-operable, appears on
// focus/hover) rendered as a SIBLING of the row's click button — never nested inside it
// (nested <button>s are invalid + unreachable). Reset to avoid the preflight-off native chrome.
export function RowRemoveButton({onRemove}: {onRemove: () => void}) {
    return (
        <button
            type="button"
            aria-label="Remove"
            onClick={(e) => {
                e.stopPropagation()
                onRemove()
            }}
            className="flex shrink-0 cursor-pointer appearance-none items-center self-center rounded border-0 bg-transparent p-0.5 text-[var(--ag-colorTextTertiary)] opacity-0 hover:bg-[var(--ag-colorFillSecondary)] hover:text-[var(--ag-colorText)] focus-visible:opacity-100 group-hover:opacity-100"
        >
            <X size={13} />
        </button>
    )
}

const containerClass = (active: boolean) =>
    `group flex w-full items-start gap-2 rounded px-2 py-1.5 ${
        active ? "bg-[var(--ag-colorPrimaryBg)]" : "hover:bg-[var(--ag-colorFillTertiary)]"
    }`

const clickClass =
    "flex min-w-0 flex-1 cursor-pointer appearance-none items-start gap-2 border-0 bg-transparent p-0 text-left"

/** An unsaved draft slot row: muted dot, name (or fallback label), "Draft · not saved". */
export function DraftListRow({
    active,
    name,
    draftLabel,
    onClick,
    onRemove,
}: {
    active: boolean
    name: string
    draftLabel: string
    onClick: () => void
    onRemove?: () => void
}) {
    return (
        <div className={containerClass(active)}>
            <button type="button" onClick={onClick} className={clickClass}>
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorTextQuaternary)]" />
                <span className="min-w-0 flex-1">
                    <span
                        className={`block truncate text-xs font-medium ${
                            active ? "text-[var(--ag-colorPrimary)]" : "text-[var(--ag-colorText)]"
                        }`}
                    >
                        {name.trim() || draftLabel}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--ag-colorTextTertiary)]">
                        Draft · not saved
                    </span>
                </span>
            </button>
            {onRemove && <RowRemoveButton onRemove={onRemove} />}
        </div>
    )
}

/** A saved entity row: status dot (running = success, else muted), title, subtitle. */
export function EntityListRow({
    active,
    running,
    title,
    titleMuted,
    subtitle,
    onClick,
    onRemove,
}: {
    active: boolean
    running: boolean
    title: string
    titleMuted?: boolean
    subtitle: string
    onClick: () => void
    onRemove?: () => void
}) {
    return (
        <div className={containerClass(active)}>
            <button type="button" onClick={onClick} className={clickClass}>
                <span
                    className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                        running
                            ? "bg-[var(--ag-colorSuccess)]"
                            : "bg-[var(--ag-colorTextQuaternary)]"
                    }`}
                />
                <span className="min-w-0 flex-1">
                    <span
                        className={`block truncate text-xs ${
                            active
                                ? "font-medium text-[var(--ag-colorPrimary)]"
                                : titleMuted
                                  ? "text-[var(--ag-colorTextTertiary)]"
                                  : "text-[var(--ag-colorText)]"
                        }`}
                    >
                        {title}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--ag-colorTextTertiary)]">
                        {subtitle}
                    </span>
                </span>
            </button>
            {onRemove && <RowRemoveButton onRemove={onRemove} />}
        </div>
    )
}

/**
 * The master-detail left rail shared by the schedule + subscription drawers: a "New …"
 * button on top and a scrollable list of rows below. Rows (drafts + entities) are
 * composed by the caller from {@link DraftListRow} / {@link EntityListRow}.
 */
export function TriggerListRail({
    newLabel,
    onNew,
    canCreate,
    isLoading,
    isEmpty,
    emptyText,
    children,
}: {
    newLabel: string
    onNew: () => void
    canCreate: boolean
    isLoading?: boolean
    isEmpty?: boolean
    emptyText: string
    children: ReactNode
}) {
    return (
        <div className="flex w-[240px] shrink-0 flex-col overflow-hidden border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)]">
            <div className="shrink-0 px-3 pb-2 pt-3">
                <Button block icon={<Plus size={14} />} onClick={onNew} disabled={!canCreate}>
                    {newLabel}
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <Spin />
                    </div>
                ) : (
                    <div className="flex flex-col gap-0.5">
                        {children}
                        {isEmpty && (
                            <Typography.Text
                                type="secondary"
                                className="!text-[11px] block px-2 py-3 leading-snug"
                            >
                                {emptyText}
                            </Typography.Text>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
