import {Fragment, useLayoutEffect, useMemo, useRef, useState} from "react"

import {formatNumber, useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDown, Plus} from "@phosphor-icons/react"

import {AgentPicker} from "./AgentPicker"
import {BUILDER_TAB_ICONS, BuilderTabButton} from "./BuilderTabButton"
import {builderTabKey, type BuilderTab} from "./builderTabs"
import {fitTabs} from "./fitTabs"
import type {AgentRef} from "./paneAgent"

/** Room kept at the end of the row for "N more" and "+". */
const MORE_WIDTH = 92
const PLUS_WIDTH = 36
/** The space between two tabs: 8 px, a 1 px line, 8 px (B03). */
const TAB_GAP = 17

/** The line between two tabs, and before "N more". */
const TabSeparator = () => <span aria-hidden className="h-4 w-px shrink-0 bg-colorBorder" />

/** The label a tab shows: its name, else the agent list's name, else the kind. */
export type TabLabel = (tab: BuilderTab) => string

/**
 * The strip of builder tabs at the top of the pane (B03): one tab per item open in this chat
 * (agent, automation, tool or app), "N more" for the tabs that do not fit (the active tab always
 * shows), and "+" ("Open an item").
 */
export const BuilderTabStrip = ({
    tabs,
    active,
    label,
    onActivate,
    onClose,
    onOpenAgent,
}: {
    tabs: BuilderTab[]
    active: string | null
    label: TabLabel
    onActivate: (key: string) => void
    /** Resolves once the tab is closed (the page may ask first). */
    onClose: (key: string) => void | Promise<void>
    onOpenAgent: (agent: AgentRef) => void
}) => {
    const t = useT(builderPageCatalog)
    const rowRef = useRef<HTMLDivElement>(null)
    const measureRef = useRef<HTMLDivElement>(null)
    const [rowWidth, setRowWidth] = useState(0)
    const [widths, setWidths] = useState<Record<string, number>>({})
    const [moreOpen, setMoreOpen] = useState(false)

    useLayoutEffect(() => {
        const row = rowRef.current
        if (!row || typeof ResizeObserver === "undefined") return
        const read = () => setRowWidth(row.getBoundingClientRect().width)
        read()
        const observer = new ResizeObserver(read)
        observer.observe(row)
        return () => observer.disconnect()
    }, [])
    // The width of every tab, measured in a hidden copy of the row.
    const labels = tabs
        .map((tab) => `${builderTabKey(tab)}=${label(tab)}=${tab.dot ? 1 : 0}`)
        .join("|")
    useLayoutEffect(() => {
        const box = measureRef.current
        if (!box) return
        const next: Record<string, number> = {}
        box.querySelectorAll<HTMLElement>("[data-tab-key]").forEach((node) => {
            next[node.dataset.tabKey ?? ""] = node.getBoundingClientRect().width
        })
        setWidths(next)
    }, [labels])

    const {visible, hidden} = useMemo(
        () =>
            fitTabs({
                keys: tabs.map(builderTabKey),
                active,
                widths,
                room: rowWidth - PLUS_WIDTH,
                moreWidth: MORE_WIDTH,
                gap: TAB_GAP,
            }),
        [active, rowWidth, tabs, widths],
    )
    const byKey = new Map(tabs.map((tab) => [builderTabKey(tab), tab]))
    const hiddenTabs = hidden.map((key) => byKey.get(key)).filter((tab): tab is BuilderTab => !!tab)

    // The closed tab held the focus: it moves to the tab that is active now.
    const tablistRef = useRef<HTMLDivElement>(null)
    const closeAndRefocus = async (key: string) => {
        await onClose(key)
        requestAnimationFrame(() =>
            tablistRef.current
                ?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")
                ?.focus(),
        )
    }

    return (
        <div ref={rowRef} className="relative flex min-w-0 flex-1 items-center gap-2">
            <div
                ref={measureRef}
                aria-hidden
                className="pointer-events-none invisible absolute left-0 top-0 flex gap-1"
            >
                {tabs.map((tab) => (
                    <BuilderTabButton
                        key={builderTabKey(tab)}
                        tab={tab}
                        label={label(tab)}
                        active={false}
                    />
                ))}
            </div>
            <div
                ref={tablistRef}
                role="tablist"
                aria-label={t("builder.page.openItems")}
                className="flex min-w-0 items-center gap-2"
                onKeyDown={(event) => {
                    // Arrow keys move the focus between the shown tabs; Enter or Space opens one.
                    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
                    if (!step) return
                    event.preventDefault()
                    const focused = (event.target as HTMLElement).closest<HTMLElement>(
                        "[data-tab-key]",
                    )?.dataset.tabKey
                    const index = Math.max(0, visible.indexOf(focused ?? ""))
                    const next = visible[(index + step + visible.length) % visible.length]
                    event.currentTarget
                        .querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(next)}"]`)
                        ?.focus()
                }}
            >
                {visible.map((key, index) => {
                    const tab = byKey.get(key)
                    if (!tab) return null
                    return (
                        <Fragment key={key}>
                            {index > 0 ? <TabSeparator /> : null}
                            <BuilderTabButton
                                tab={tab}
                                label={label(tab)}
                                active={key === active}
                                onActivate={() => onActivate(key)}
                                onClose={() => void closeAndRefocus(key)}
                            />
                        </Fragment>
                    )
                })}
            </div>
            {hiddenTabs.length > 0 ? <TabSeparator /> : null}
            {hiddenTabs.length > 0 ? (
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-haspopup="menu"
                            title={hiddenTabs.map(label).join(", ")}
                            className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border-0 bg-transparent px-2 text-[12px] leading-5 text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
                        >
                            {t("builder.page.moreTabs", {count: formatNumber(hiddenTabs.length)})}
                            <CaretDown aria-hidden size={12} className="text-colorTextTertiary" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="flex w-60 flex-col p-1">
                        {hiddenTabs.map((tab) => {
                            const KindIcon = BUILDER_TAB_ICONS[tab.kind]
                            return (
                                <button
                                    key={builderTabKey(tab)}
                                    type="button"
                                    onClick={() => {
                                        setMoreOpen(false)
                                        onActivate(builderTabKey(tab))
                                    }}
                                    className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[13px] text-colorText hover:bg-colorFillTertiary"
                                >
                                    <KindIcon
                                        aria-hidden
                                        size={14}
                                        className="shrink-0 text-colorTextSecondary"
                                    />
                                    <span className="min-w-0 flex-1 truncate">{label(tab)}</span>
                                    {tab.dot ? (
                                        <span className="size-1.5 shrink-0 rounded-full bg-colorPrimary" />
                                    ) : null}
                                </button>
                            )
                        })}
                    </PopoverContent>
                </Popover>
            ) : null}
            <AgentPicker
                onPick={onOpenAgent}
                trigger={
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        aria-label={t("builder.page.openItem")}
                        title={t("builder.page.openItem")}
                        className="shrink-0"
                    >
                        <Plus aria-hidden />
                    </Button>
                }
            />
        </div>
    )
}
