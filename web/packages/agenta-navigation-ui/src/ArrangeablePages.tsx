import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react"

import type {SidebarArrange, SidebarConfig} from "@agenta/navigation"
import {Popover, PopoverContent, PopoverTrigger, cn} from "@agenta/ui/ui"
import {ArrowCounterClockwise, DotsThree} from "@phosphor-icons/react"
import {
    AnimatePresence,
    Reorder,
    useDragControls,
    useReducedMotion,
    type PanInfo,
} from "motion/react"
import Link from "next/link"

import {ROW_BASE, ROW_INTERACTIVE, ROW_SELECTED} from "./rowStyles"

const MOUSE_SLOP_PX = 4
const TOUCH_HOLD_MS = 350
const TOUCH_SLOP_PX = 8
const SETTLE = {type: "spring", stiffness: 500, damping: 40, mass: 0.8} as const
const LIFTED =
    "z-20 rounded-md bg-[var(--ag-sidebar-bg)] [&>div:first-child]:bg-colorBgElevated [&>div:first-child]:shadow-overlay [&>div:first-child]:cursor-grabbing"
const DROP_TARGET =
    "bg-[var(--ag-shell-selected-bg)] !text-colorText shadow-[inset_0_0_0_1px_currentColor]"
const MENU_ROW =
    "flex h-8 w-full cursor-pointer items-center gap-[10px] rounded-md border-0 bg-transparent px-2 text-left text-sm text-colorText no-underline [font-family:inherit] select-none hover:bg-colorFillTertiary"

/** Calls `begin` after a small mouse move or a touch long-press, so a tap still clicks and a swipe still scrolls. */
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
    appear,
    reduced,
    takePull,
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
    appear: boolean
    reduced: boolean
    /** A drag begun on this page's row in "More", to continue here once the row mounts. */
    takePull: (key: string) => PointerEvent | null
    onDragStart: (key: string) => void
    onDrag: (info: PanInfo) => void
    onDragEnd: (key: string) => void
    onMoveKey: (key: string, delta: -1 | 1) => void
    children: ReactNode
}) => {
    const controls = useDragControls()
    // An effect, not a layout effect: motion attaches the row's drag handlers in its own effect.
    useEffect(() => {
        const pulled = takePull(value)
        if (pulled) controls.start(pulled, {snapToCursor: true})
    }, [controls, takePull, value])

    return (
        <Reorder.Item
            as="div"
            value={value}
            dragListener={false}
            dragControls={controls}
            layout={reduced ? undefined : "position"}
            transition={SETTLE}
            initial={reduced || !appear ? false : {opacity: 0, height: 0}}
            animate={{opacity: dropping ? 0.55 : 1, height: "auto"}}
            exit={reduced ? {opacity: 0} : {opacity: 0, height: 0, overflow: "hidden"}}
            whileDrag={{scale: 1.02}}
            className={cn("relative flex flex-col [-webkit-touch-callout:none]", lifted && LIFTED)}
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

const MoreMenu = ({
    hidden,
    onPull,
    onPick,
    onReset,
}: {
    hidden: SidebarConfig[]
    onPull?: (item: SidebarConfig, event: PointerEvent) => void
    onPick: () => void
    onReset: () => void
}) => (
    <div className="flex flex-col p-1">
        <div className="px-2 pb-1 pt-1.5 text-xs text-colorTextTertiary">More pages</div>
        {hidden.length ? (
            hidden.map((item) => (
                <Link
                    key={item.key}
                    href={item.link ?? "#"}
                    draggable={false}
                    prefetch={item.prefetch}
                    className={cn(MENU_ROW, onPull && "[-webkit-touch-callout:none]")}
                    onClick={onPick}
                    onPointerDown={
                        onPull ? (event) => pressToDrag(event, (e) => onPull(item, e)) : undefined
                    }
                >
                    <span className="flex shrink-0 items-center">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                </Link>
            ))
        ) : (
            <p className="m-0 px-2 pb-2 pt-1 text-[13px] leading-[18px] text-colorTextTertiary">
                Every page is in the sidebar.
            </p>
        )}
        <div className="my-1 h-px bg-colorBorderSecondary" />
        <button type="button" className={MENU_ROW} onClick={onReset}>
            <ArrowCounterClockwise size={16} className="shrink-0" />
            <span>Reset to default</span>
        </button>
    </div>
)

/** The top-level pages, arranged by drag: reorder in place, drop on "More" to hide, drag out of it to show. */
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
    const reduced = Boolean(useReducedMotion())
    const [moreOpen, setMoreOpen] = useState(false)
    const [draft, setDraft] = useState<string[] | null>(null)
    const [pulled, setPulled] = useState<SidebarConfig | null>(null)
    const [dragging, setDragging] = useState<string | null>(null)
    const [overMore, setOverMore] = useState(false)
    const moreRef = useRef<HTMLButtonElement>(null)
    const pending = useRef<{key: string; event: PointerEvent} | null>(null)
    const live = useRef({draft, overMore: false, started: false, suppressClick: false})
    live.current.draft = draft

    const keys = items.map((item) => item.key)
    const order = draft ?? keys
    const byKey = new Map([...items, ...arrange.hidden].map((item) => [item.key, item]))
    const hiddenKeys = arrange.hidden.map((item) => item.key)
    const menuHidden = arrange.hidden.filter((item) => item.key !== pulled?.key)

    const takePull = useCallback((key: string) => {
        if (pending.current?.key !== key) return null
        const {event} = pending.current
        pending.current = null
        return event
    }, [])

    const commit = (visible: string[], hidden: string[]) => {
        if (sameOrder(visible, keys) && sameOrder(hidden, hiddenKeys)) return
        arrange.onArrange(visible, hidden)
    }

    const finish = (key: string) => {
        const next = live.current.draft ?? keys
        const rest = hiddenKeys.filter((hiddenKey) => hiddenKey !== key)
        if (live.current.overMore)
            commit(
                next.filter((k) => k !== key),
                [...rest, key],
            )
        else commit(next, rest)
        live.current = {...live.current, overMore: false, started: false}
        pending.current = null
        setTimeout(() => {
            live.current.suppressClick = false
        })
        setDraft(null)
        setPulled(null)
        setDragging(null)
        setOverMore(false)
    }

    const onDragStart = (key: string) => {
        live.current.started = true
        live.current.suppressClick = true
        setDragging(key)
        setDraft((current) => current ?? keys)
    }

    const onDrag = (info: PanInfo) => {
        const rect = moreRef.current?.getBoundingClientRect()
        const x = info.point.x - window.scrollX
        const y = info.point.y - window.scrollY
        const over = Boolean(
            rect && x >= rect.left && x <= rect.right && y >= rect.top - 4 && y <= rect.bottom + 8,
        )
        if (over === live.current.overMore) return
        live.current.overMore = over
        setOverMore(over)
    }

    const pull = (item: SidebarConfig, event: PointerEvent) => {
        live.current.started = false
        pending.current = {key: item.key, event}
        live.current.draft = [...keys, item.key]
        setMoreOpen(false)
        setPulled(item)
        setDragging(item.key)
        setDraft(live.current.draft)
        // A release before the drag engaged still lands the page at the end.
        window.addEventListener(
            "pointerup",
            () => setTimeout(() => !live.current.started && finish(item.key)),
            {once: true},
        )
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

    const reset = () => {
        setMoreOpen(false)
        arrange.onReset()
    }

    if (collapsed) {
        return (
            <>
                {items.map(renderItem)}
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label="More"
                            className={cn(
                                "relative mx-auto flex size-8 items-center justify-center rounded-lg border-0 bg-transparent",
                                ROW_INTERACTIVE,
                                moreOpen && ROW_SELECTED,
                            )}
                        >
                            <DotsThree size={16} />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        side="right"
                        align="start"
                        sideOffset={8}
                        className="z-[2000] w-[248px] rounded-[10px] border border-solid border-colorBorderSecondary bg-colorBgElevated p-0 shadow-md"
                    >
                        <MoreMenu
                            hidden={arrange.hidden}
                            onPick={() => setMoreOpen(false)}
                            onReset={reset}
                        />
                    </PopoverContent>
                </Popover>
            </>
        )
    }

    const dropping = overMore && dragging !== null
    return (
        <div
            className="flex flex-col"
            onClickCapture={(event) => {
                if (!live.current.suppressClick) return
                live.current.suppressClick = false
                event.preventDefault()
                event.stopPropagation()
            }}
        >
            <Reorder.Group
                as="div"
                axis="y"
                values={order}
                onReorder={setDraft}
                className="flex flex-col"
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
                                appear={key !== pulled?.key}
                                reduced={reduced}
                                takePull={takePull}
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
                            "border-0 bg-transparent text-left [font-family:inherit] !text-colorTextSecondary transition-[background-color,box-shadow] duration-150",
                            moreOpen && ROW_SELECTED,
                            dropping && DROP_TARGET,
                        )}
                    >
                        <DotsThree size={16} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                            {dragging ? "Drop here to hide" : "More"}
                        </span>
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    container={moreRef.current?.closest<HTMLElement>('[data-slot="sheet-content"]')}
                    side={
                        moreRef.current?.closest('[data-slot="sheet-content"]') ? "bottom" : "right"
                    }
                    align="start"
                    sideOffset={2}
                    className="z-[2000] w-[248px] rounded-[10px] border border-solid border-colorBorderSecondary bg-colorBgElevated p-0 shadow-md"
                >
                    <MoreMenu
                        hidden={menuHidden}
                        onPull={pull}
                        onPick={() => setMoreOpen(false)}
                        onReset={reset}
                    />
                </PopoverContent>
            </Popover>
        </div>
    )
}
