import {
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import type {SidebarArrange, SidebarConfig} from "@agenta/navigation"
import {SimpleTooltip} from "@agenta/ui/composed"
import {
    Button,
    MENU_ITEM,
    MENU_ITEM_INSET,
    Popover,
    PopoverContent,
    PopoverTrigger,
    cn,
} from "@agenta/ui/ui"
import {ArrowCounterClockwise, DotsThree, PushPin} from "@phosphor-icons/react"
import {
    AnimatePresence,
    Reorder,
    useDragControls,
    useReducedMotion,
    type PanInfo,
    type Transition,
} from "motion/react"
import Link from "next/link"

import {CAPTION_CLASS, PANEL_CLASS} from "./ProjectOrgSwitcher"
import {ROW_BASE, ROW_INTERACTIVE, ROW_SELECTED} from "./rowStyles"

const MORE_PANEL_CLASS = PANEL_CLASS

const MOUSE_SLOP_PX = 4
const TOUCH_HOLD_MS = 350
const TOUCH_SLOP_PX = 8
// duration-base and ease-in-out from theme.config.ts (motion needs numbers, not CSS variables).
const SETTLE: Transition = {duration: 0.2, ease: [0.4, 0, 0.2, 1]}
const LIFTED =
    "z-20 rounded-md bg-muted [&>div:first-child]:bg-popover [&>div:first-child]:shadow-raised [&>div:first-child]:cursor-grabbing"
const DROP_TARGET = "bg-selected !text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
const MENU_ROW = cn(
    MENU_ITEM,
    "border-0 bg-transparent text-left text-foreground no-underline [font-family:inherit] hover:bg-accent focus-ring-inset",
)

/** Starts a drag after a small mouse move or a touch long-press, so taps click and swipes scroll. */
const pressToDrag = (press: ReactPointerEvent, begin: (event: PointerEvent) => void) => {
    if (press.button !== 0) return
    if ((press.target as HTMLElement).closest("button, input, [role='button']")) return
    const touch = press.pointerType !== "mouse"
    const origin = {x: press.clientX, y: press.clientY}
    let armed = false
    const holdScroll = (event: TouchEvent) => {
        if (armed) event.preventDefault()
    }
    const stop = () => {
        clearTimeout(timer)
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", stop)
        window.removeEventListener("pointercancel", stop)
        window.removeEventListener("touchmove", holdScroll)
        window.removeEventListener("contextmenu", holdMenu)
    }
    const holdMenu = (event: Event) => {
        if (armed) event.preventDefault()
    }
    const move = (event: PointerEvent) => {
        if (armed) return
        const travel = Math.hypot(event.clientX - origin.x, event.clientY - origin.y)
        if (touch) {
            if (travel > TOUCH_SLOP_PX) stop()
        } else if (travel >= MOUSE_SLOP_PX) {
            armed = true
            begin(event)
        }
    }
    const timer = touch
        ? setTimeout(() => {
              armed = true
              begin(press.nativeEvent)
          }, TOUCH_HOLD_MS)
        : undefined
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    window.addEventListener("touchmove", holdScroll, {passive: false})
    window.addEventListener("contextmenu", holdMenu)
}

const sameOrder = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((key, index) => key === b[index])

const SortableRow = ({
    value,
    lifted,
    dropping,
    reduced,
    onDragStart,
    onDrag,
    onDragEnd,
    onMoveKey,
    children,
}: {
    value: string
    lifted: boolean
    /** Lifted over "More": faded so the drop target shows through. */
    dropping: boolean
    reduced: boolean
    onDragStart: (key: string) => void
    onDrag: (info: PanInfo) => void
    onDragEnd: (key: string) => void
    onMoveKey: (key: string, delta: -1 | 1) => void
    children: ReactNode
}) => {
    const controls = useDragControls()

    return (
        <Reorder.Item
            as="div"
            value={value}
            dragListener={false}
            dragControls={controls}
            layout={reduced ? undefined : "position"}
            transition={SETTLE}
            initial={reduced ? false : {opacity: 0, height: 0}}
            animate={{opacity: dropping ? 0.55 : 1, height: "auto"}}
            exit={reduced ? {opacity: 0} : {opacity: 0, height: 0, overflow: "hidden"}}
            whileDrag={reduced ? undefined : {scale: 1.02}}
            data-page-key={value}
            className={cn(
                "relative flex flex-col gap-1 [-webkit-touch-callout:none]",
                lifted && LIFTED,
            )}
            onPointerDown={(event) => {
                const header = event.currentTarget.firstElementChild
                if (!header?.contains(event.target as Node)) return
                pressToDrag(event, (start) => controls.start(start))
            }}
            onKeyDown={(event: KeyboardEvent) => {
                if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                event.preventDefault()
                onMoveKey(value, event.key === "ArrowUp" ? -1 : 1)
            }}
            onDragStart={() => onDragStart(value)}
            onDrag={(_, info) => onDrag(info)}
            onDragEnd={() => onDragEnd(value)}
        >
            {children}
        </Reorder.Item>
    )
}

/** Opening focuses the first page row, not its pin button, so the pin's tooltip stays shut. */
const focusFirstPage = (event: Event) => {
    const row = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("a[href]")
    if (!row) return
    event.preventDefault()
    row.focus()
}

const MoreMenu = ({
    hidden,
    onPull,
    onPick,
    onPin,
    onReset,
}: {
    hidden: SidebarConfig[]
    onPull?: (item: SidebarConfig, event: PointerEvent) => void
    onPick: () => void
    onPin: (key: string) => void
    onReset: () => void
}) => {
    const t = useT(navigationCatalog)
    const go = (item: SidebarConfig) => (event: ReactMouseEvent) => {
        item.onClick?.(event)
        onPick()
    }
    return (
        <div className="flex flex-col p-1">
            <div className={CAPTION_CLASS}>{t("navigation.arrange.morePages")}</div>
            {hidden.length ? (
                hidden.map((item) => {
                    // A group has no page of its own: its title heads its pages.
                    const group = !item.link && Boolean(item.submenu?.length)
                    return (
                        <div key={item.key} className="flex flex-col [&+&]:mt-0.5">
                            {/* ag-menu-row: the child rows below keep MENU_ITEM's 2px gap to it. */}
                            <div className="ag-menu-row flex items-center rounded-sm hover:bg-accent">
                                <Link
                                    href={item.link ?? "#"}
                                    draggable={false}
                                    prefetch={item.prefetch}
                                    aria-disabled={group || undefined}
                                    className={cn(
                                        MENU_ROW,
                                        "min-w-0 flex-1 hover:bg-transparent",
                                        group && "cursor-default",
                                        onPull && "[-webkit-touch-callout:none]",
                                    )}
                                    onClick={group ? (event) => event.preventDefault() : go(item)}
                                    onPointerDown={
                                        onPull
                                            ? (event) => pressToDrag(event, (e) => onPull(item, e))
                                            : undefined
                                    }
                                >
                                    <span className="flex shrink-0 items-center">{item.icon}</span>
                                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                                </Link>
                                <SimpleTooltip title={t("navigation.arrange.pinToSidebar")}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={t("navigation.arrange.pinPage", {
                                            title: item.title,
                                        })}
                                        className="mr-1 shrink-0 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                        onClick={() => onPin(item.key)}
                                    >
                                        <PushPin />
                                    </Button>
                                </SimpleTooltip>
                            </div>
                            {group
                                ? item.submenu
                                      ?.filter((child) => child.link && !child.isHidden)
                                      .map((child) => (
                                          <Link
                                              key={child.key}
                                              href={child.link ?? "#"}
                                              draggable={false}
                                              prefetch={child.prefetch}
                                              className={cn(MENU_ROW, MENU_ITEM_INSET)}
                                              onClick={go(child)}
                                          >
                                              <span className="min-w-0 flex-1 truncate">
                                                  {child.title}
                                              </span>
                                          </Link>
                                      ))
                                : null}
                        </div>
                    )
                })
            ) : (
                <p className="m-0 px-2 pb-2 pt-1 text-label text-muted-foreground">
                    {t("navigation.arrange.allVisible")}
                </p>
            )}
            <div className="my-1 h-px bg-border-muted" />
            <button type="button" className={MENU_ROW} onClick={onReset}>
                <ArrowCounterClockwise className="shrink-0" />
                <span>{t("navigation.arrange.reset")}</span>
            </button>
        </div>
    )
}

/** The top-level pages: drag to reorder, drop on "More" to hide, drag out of it to show. */
export const ArrangeablePages = ({
    items,
    arrange,
    collapsed,
    renderItem,
}: {
    items: SidebarConfig[]
    arrange: SidebarArrange
    collapsed: boolean
    renderItem: (item: SidebarConfig) => ReactNode
}) => {
    const t = useT(navigationCatalog)
    const reduced = Boolean(useReducedMotion())
    const [moreOpen, setMoreOpen] = useState(false)
    const [draft, setDraft] = useState<string[] | null>(null)
    const [pulled, setPulled] = useState<SidebarConfig | null>(null)
    const [dragging, setDragging] = useState<string | null>(null)
    const [overMore, setOverMore] = useState(false)
    const moreRef = useRef<HTMLButtonElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const live = useRef({draft, overMore: false, suppressClick: false})
    live.current.draft = draft

    const keys = items.map((item) => item.key)
    const order = draft ?? keys
    const byKey = new Map([...items, ...arrange.hidden].map((item) => [item.key, item]))
    const hiddenKeys = arrange.hidden.map((item) => item.key)
    const menuHidden = arrange.hidden.filter((item) => item.key !== pulled?.key)

    const commit = (visible: string[], hidden: string[]) => {
        if (sameOrder(visible, keys) && sameOrder(hidden, hiddenKeys)) return
        arrange.onArrange(visible, hidden)
    }

    const finish = (key: string) => {
        const next = live.current.draft ?? keys
        const rest = hiddenKeys.filter((hiddenKey) => hiddenKey !== key)
        // A page already in "More" keeps its place there; a newly hidden one goes last.
        if (live.current.overMore)
            commit(
                next.filter((k) => k !== key),
                hiddenKeys.includes(key) ? hiddenKeys : [...rest, key],
            )
        else commit(next, rest)
        live.current.overMore = false
        setTimeout(() => {
            live.current.suppressClick = false
        })
        setDraft(null)
        setPulled(null)
        setDragging(null)
        setOverMore(false)
    }

    const onDragStart = (key: string) => {
        live.current.suppressClick = true
        setDragging(key)
        setDraft((current) => current ?? keys)
    }

    // The last page left in the sidebar cannot be hidden; a page pulled from "More" can go back.
    const lastPage = keys.length <= 1
    const trackMore = (x: number, y: number, canHide = !lastPage) => {
        const rect = moreRef.current?.getBoundingClientRect()
        const over = Boolean(
            canHide &&
            rect &&
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top - 4 &&
            y <= rect.bottom + 8,
        )
        if (over === live.current.overMore) return
        live.current.overMore = over
        setOverMore(over)
    }

    const onDrag = (info: PanInfo) =>
        trackMore(info.point.x - window.scrollX, info.point.y - window.scrollY)

    // A page dragged out of "More" takes the slot under the pointer; dropped outside the list it stays hidden.
    const pull = (item: SidebarConfig, event: PointerEvent) => {
        const place = (e: PointerEvent) => {
            const rows = Array.from(
                listRef.current?.querySelectorAll<HTMLElement>("[data-page-key]") ?? [],
            ).filter((row) => row.dataset.pageKey !== item.key)
            const index = rows.filter((row) => {
                const rect = row.getBoundingClientRect()
                return rect.top + rect.height / 2 < e.clientY
            }).length
            const next = [...keys]
            next.splice(index, 0, item.key)
            if (!sameOrder(next, live.current.draft ?? [])) {
                live.current.draft = next
                setDraft(next)
            }
            trackMore(e.clientX, e.clientY, true)
        }
        const release = (e: PointerEvent) => {
            window.removeEventListener("pointermove", place)
            window.removeEventListener("pointerup", release)
            window.removeEventListener("pointercancel", release)
            const list = listRef.current?.getBoundingClientRect()
            if (
                e.type === "pointercancel" ||
                !list ||
                e.clientX < list.left ||
                e.clientX > list.right ||
                e.clientY < list.top ||
                e.clientY > list.bottom
            )
                live.current.overMore = true
            finish(item.key)
        }
        live.current.suppressClick = true
        setMoreOpen(false)
        setPulled(item)
        setDragging(item.key)
        place(event)
        window.addEventListener("pointermove", place)
        window.addEventListener("pointerup", release)
        window.addEventListener("pointercancel", release)
    }

    const moveByKey = (key: string, delta: -1 | 1) => {
        const from = keys.indexOf(key)
        const to = from + delta
        if (from < 0 || to < 0 || to >= keys.length) return
        const next = [...keys]
        next.splice(from, 1)
        next.splice(to, 0, key)
        commit(next, hiddenKeys)
    }

    const pin = (key: string) => {
        setMoreOpen(false)
        commit(
            [...keys, key],
            hiddenKeys.filter((hiddenKey) => hiddenKey !== key),
        )
    }

    const reset = () => {
        setMoreOpen(false)
        arrange.onReset()
    }

    if (collapsed) {
        return (
            <>
                {items.map(renderItem)}
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                    {/* The span takes the tooltip, so two asChild triggers do not share one element. */}
                    <SimpleTooltip title={t("navigation.arrange.more")} side="right">
                        <span className="mx-auto inline-flex">
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={t("navigation.arrange.more")}
                                    className={cn(
                                        "relative flex size-7 items-center justify-center rounded-md border-0 bg-transparent focus-ring",
                                        ROW_INTERACTIVE,
                                        moreOpen && ROW_SELECTED,
                                    )}
                                >
                                    <span data-row-icon className="flex">
                                        <DotsThree size={16} />
                                    </span>
                                </button>
                            </PopoverTrigger>
                        </span>
                    </SimpleTooltip>
                    <PopoverContent
                        side="right"
                        align="start"
                        sideOffset={8}
                        className={MORE_PANEL_CLASS}
                        onOpenAutoFocus={focusFirstPage}
                    >
                        <MoreMenu
                            hidden={arrange.hidden}
                            onPick={() => setMoreOpen(false)}
                            onPin={pin}
                            onReset={reset}
                        />
                    </PopoverContent>
                </Popover>
            </>
        )
    }

    const dropping = overMore && dragging !== null
    const keepsLast = dragging !== null && lastPage && keys.includes(dragging)
    // In the phone sheet the menu portals into the sheet and opens below the row.
    const sheet = moreRef.current?.closest<HTMLElement>('[data-slot="sheet-content"]')

    return (
        <div
            className="flex flex-col gap-1"
            onClickCapture={(event) => {
                if (!live.current.suppressClick) return
                live.current.suppressClick = false
                event.preventDefault()
                event.stopPropagation()
            }}
        >
            <Reorder.Group
                ref={listRef}
                as="div"
                axis="y"
                values={order}
                onReorder={setDraft}
                // Dense rail rows sit 4px apart (ROW-04).
                className="flex flex-col gap-1"
            >
                <AnimatePresence initial={false}>
                    {order.map((key) => {
                        const item = byKey.get(key)
                        if (!item) return null
                        return (
                            <SortableRow
                                key={key}
                                value={key}
                                lifted={dragging === key}
                                dropping={dragging === key && overMore}
                                reduced={reduced}
                                onDragStart={onDragStart}
                                onDrag={onDrag}
                                onDragEnd={finish}
                                onMoveKey={moveByKey}
                            >
                                {renderItem(item)}
                            </SortableRow>
                        )
                    })}
                </AnimatePresence>
            </Reorder.Group>
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger asChild>
                    <button
                        ref={moreRef}
                        type="button"
                        className={cn(
                            ROW_BASE,
                            ROW_INTERACTIVE,
                            "border-0 bg-transparent text-left [font-family:inherit] !text-muted-foreground transition-[background-color,box-shadow] focus-ring-inset",
                            moreOpen && ROW_SELECTED,
                            dropping && DROP_TARGET,
                        )}
                    >
                        <DotsThree size={16} className="shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                            {keepsLast
                                ? t("navigation.arrange.keepOne")
                                : dragging
                                  ? t("navigation.arrange.dropToHide")
                                  : t("navigation.arrange.more")}
                        </span>
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    container={sheet}
                    side={sheet ? "bottom" : "right"}
                    align="start"
                    sideOffset={2}
                    className={MORE_PANEL_CLASS}
                    onOpenAutoFocus={focusFirstPage}
                >
                    <MoreMenu
                        hidden={menuHidden}
                        onPull={pull}
                        onPick={() => setMoreOpen(false)}
                        onPin={pin}
                        onReset={reset}
                    />
                </PopoverContent>
            </Popover>
        </div>
    )
}
