/**
 * THE session tab rail — the horizontal strip of session chips that sits above a conversation, so
 * switching sessions is one tap and the neighbours stay visible.
 *
 * The strip and the chips are the SAME components the desktop playground's tab bar renders
 * (`SessionTabStrip` + `SessionTab`); this adds the one thing that differs — where the tabs come
 * from. Rows are the shared `useSessionCardList` → `SessionRowVm` (shared status meta, shared title
 * precedence), so a session reads the same here as in every list. Only the host's verbs arrive as
 * props: how a chip opens, and what "new" means.
 */
import type {ReactNode} from "react"
import {useCallback, useEffect, useMemo, useRef} from "react"

import {sessionRowStatusMeta, type SessionRowVm} from "@agenta/sessions/row"
import {
    applySessionTabOrder,
    openSessionTabRows,
    sessionTabCloseTargets,
    sessionTabOrderAtomFamily,
    sessionTabScope,
    setSessionTabOrderAtom,
    useOpenSessionTabs,
    usePublishRenderedSessionTabs,
    useSessionCardList,
    useSessionTabOrderSeed,
    type SessionTabCloseTargets,
    type UseSessionCardListArgs,
} from "@agenta/sessions/state"
import {Skeleton, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowLineRightIcon, XIcon, XSquareIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {type SessionMenuEntry} from "./menu"
import {SessionRowContextMenu} from "./SessionRowContextMenu"
import {SessionTab} from "./SessionTab"
import {SessionTabDragItem} from "./SessionTabDragItem"
import {SessionTabStrip} from "./SessionTabStrip"

export interface SessionTabRailProps extends UseSessionCardListArgs {
    /** The session on screen — its chip is the active one. */
    activeSessionId: string
    /** Open a session (the host routes). */
    onSelect: (vm: SessionRowVm) => void
    /** Start a new session. Omit where the surface has nothing to start one with. */
    onNew?: () => void
    /**
     * Title for the active session when the capped list does not contain it (an old session opened
     * by URL) — without it the rail would show no active chip and the surface would not name the
     * conversation you are in.
     */
    activeFallbackTitle?: string | null
    /**
     * Right-click / long-press verbs for a chip, in the shared neutral shape — the SAME props the
     * card list takes, so a session offers the same actions as a tab and as a row. Omit for no menu.
     */
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /**
     * Close one tab. The rail supplies the RENDERED order alongside it, because the survivor a
     * host routes to is defined over what is on screen and only the rail knows that. Omit and no
     * close affordance mounts at all.
     */
    onClose?: (vm: SessionRowVm, ordered: readonly string[]) => void
    /** Close several — "Close other tabs" and "Close tabs to the right". */
    onCloseMany?: (ids: string[], ordered: readonly string[]) => void
    /**
     * Drag to hand-arrange the tabs, persisted per agent. On by default — a tab strip is a place
     * users expect to arrange. Off leaves the rail in list order.
     */
    reorderable?: boolean
    /** Right-aligned extras, pinned outside the scroller (files opener, history menu). */
    extra?: ReactNode
    /** Leading extra, pinned before the scroller — the config-panel reveal control, rendered at
     * the spot the config panel disappeared from. */
    leadingExtra?: ReactNode
    className?: string
}

/**
 * A row as a chip: the shared `SessionTab`, with the status dot derived from the row view-model
 * (the desktop passes its own live-status dot instead). The wrapper keeps the active chip in view.
 */
const RailTab = ({
    vm,
    active,
    onSelect,
    menuFor,
    onMenuSelect,
    draggable,
    divided,
    onClose,
}: {
    vm: SessionRowVm
    active: boolean
    onSelect: (vm: SessionRowVm) => void
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /** Omit where tabs are not closeable — then no × mounts. */
    onClose?: () => void
    /** A drag slot only inside a reorder group — a lone `Reorder.Item` has no context to drag in. */
    draggable: boolean
    /** Hairline before this tab. Suppressed either side of the filled active chip. */
    divided?: boolean
}) => {
    const ref = useRef<HTMLDivElement>(null)
    // Reveal the active chip ONLY when it is actually off-screen. Scrolling on every activation
    // meant that picking a session you could already see still yanked the rail — you scroll
    // through a long strip, click, and it jumps back to centre the chip you just clicked. The
    // desktop bar applies the same rule to its enter-animation nudge: move only when the tab
    // pokes past a visible edge.
    useEffect(() => {
        if (!active) return
        const tab = ref.current
        if (!tab) return
        let scroller: HTMLElement | null = tab.parentElement
        while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowX)) {
            scroller = scroller.parentElement
        }
        if (!scroller) return
        const t = tab.getBoundingClientRect()
        const s = scroller.getBoundingClientRect()
        if (t.right > s.right || t.left < s.left) {
            tab.scrollIntoView({block: "nearest", inline: "nearest"})
        }
    }, [active])
    const handleSelect = useCallback(() => onSelect(vm), [onSelect, vm])

    const chip = (
        <SessionRowContextMenu entries={menuFor?.(vm)} onSelect={(key) => onMenuSelect?.(vm, key)}>
            <SessionTab
                active={active}
                label={vm.title}
                onSelect={handleSelect}
                renderActions={
                    onClose
                        ? () => (
                              <button
                                  type="button"
                                  aria-label={`Close ${vm.title}`}
                                  onClick={(event) => {
                                      event.stopPropagation()
                                      onClose()
                                  }}
                                  className="text-colorTextTertiary hover:text-colorText flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              >
                                  <XIcon size={12} />
                              </button>
                          )
                        : undefined
                }
                statusDot={
                    <SimpleTooltip title={vm.status.label}>
                        <span
                            aria-label={vm.status.label}
                            className={clsx(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                vm.status.dotClassName,
                                vm.status.pulse && "motion-safe:animate-pulse",
                            )}
                        />
                    </SimpleTooltip>
                }
            />
        </SessionRowContextMenu>
    )

    const wrapper = clsx("mr-1.5 shrink-0", divided && TAB_DIVIDER)
    return draggable ? (
        <SessionTabDragItem ref={ref} id={vm.id} className={wrapper}>
            {chip}
        </SessionTabDragItem>
    ) : (
        <div ref={ref} className={wrapper}>
            {chip}
        </div>
    )
}

/** The fallback chip IS the open session — selecting it would be a no-op route push. */
const noop = () => undefined

/**
 * The rail's own menu verbs, appended to the host's. Reserved keys, handled here and never
 * forwarded — the host knows nothing about tab order.
 *
 * They exist because touch cannot drag: a long press opens this very menu (see SessionTabDragItem),
 * so moving a tab by hand has to be sayable in words too. They are equally the keyboard path.
 */
const MOVE_LEFT = "__rail-move-left"
const MOVE_RIGHT = "__rail-move-right"

/** Chrome's tab-close verbs, likewise reserved and handled here. */
const CLOSE = "__rail-close"
const CLOSE_OTHERS = "__rail-close-others"
const CLOSE_RIGHT = "__rail-close-right"

const closeEntries = (targets: SessionTabCloseTargets): SessionMenuEntry[] => [
    {type: "divider"},
    {key: CLOSE, label: "Close", icon: <XIcon size={14} />, disabled: !targets.closable},
    {
        key: CLOSE_OTHERS,
        label: "Close other tabs",
        icon: <XSquareIcon size={14} />,
        disabled: targets.others.length === 0,
    },
    {
        key: CLOSE_RIGHT,
        label: "Close tabs to the right",
        icon: <ArrowLineRightIcon size={14} />,
        disabled: targets.toRight.length === 0,
    },
]

const moveEntries = (index: number, count: number): SessionMenuEntry[] =>
    count < 2
        ? []
        : [
              {type: "divider"},
              {key: MOVE_LEFT, label: "Move left", disabled: index === 0},
              {key: MOVE_RIGHT, label: "Move right", disabled: index === count - 1},
          ]

/** Moves the id at `index` one slot in `direction`, returning the new order. */
const moved = (ids: string[], index: number, direction: -1 | 1): string[] => {
    const target = index + direction
    if (target < 0 || target >= ids.length) return ids
    const next = [...ids]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
}

/** The hairline the tab chips are "separated by" — see SessionTab's own note. Drawn in the gap
 *  left of a tab, so it never touches the chip's own fill. */
const TAB_DIVIDER =
    "relative before:absolute before:-left-[7px] before:top-1/2 before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-colorBorderSecondary before:content-['']"

/** The pending tab has no stream yet, so it wears the same idle chrome every quiet row does. */
const IDLE_STATUS = sessionRowStatusMeta("idle")

export const SessionTabRail = ({
    activeSessionId,
    onSelect,
    onNew,
    extra,
    leadingExtra,
    activeFallbackTitle,
    menuFor,
    onMenuSelect,
    onClose,
    onCloseMany,
    reorderable = true,
    className,
    ...listArgs
}: SessionTabRailProps) => {
    const list = useSessionCardList(listArgs)
    // One strip, in list order — the card list's waiting/pinned/recent headings are a vertical
    // idea; a tab strip has no room for them and the status dots already carry the urgency.
    const listRows = useMemo(() => list.groups.flatMap((group) => group.rows), [list.groups])
    // A rail is arranged by hand, so the user's order wins over the list's. Scoped to the agent
    // whose sessions these are — arranging one agent's rail says nothing about another's.
    const orderScope = sessionTabScope(listArgs.agentId)
    const savedOrder = useAtomValue(sessionTabOrderAtomFamily(orderScope))
    const setSavedOrder = useSetAtom(setSessionTabOrderAtom)
    const arranged = useMemo(
        () => applySessionTabOrder(listRows, savedOrder),
        [listRows, savedOrder],
    )
    const listedIds = useMemo(() => arranged.map((vm) => vm.id), [arranged])
    // Rank every session the list carries, open or not, so reopening one restores its old slot.
    useSessionTabOrderSeed(orderScope, listedIds)
    // Membership is the user's own: tabs are an explicit set here, not a view of the server list.
    const openIds = useOpenSessionTabs(orderScope, listedIds, activeSessionId)
    const rows = useMemo(
        () => openSessionTabRows(arranged, openIds, activeSessionId),
        [arranged, openIds, activeSessionId],
    )
    const hasActive = rows.some((vm) => vm.id === activeSessionId)
    const orderedIds = useMemo(() => rows.map((vm) => vm.id), [rows])
    // Published so a keyboard surface outside the rail can address "the Nth tab".
    usePublishRenderedSessionTabs(orderScope, orderedIds)
    const closeTabs = useMemo(() => rows.map((vm) => ({id: vm.id, pinned: vm.isPinned})), [rows])
    // Persist the WHOLE visible order on every drop, so sessions the saved order had never seen are
    // captured by the first arrangement that touches them.
    const handleReorder = useCallback(
        (ids: string[]) => setSavedOrder({scope: orderScope, ids}),
        [orderScope, setSavedOrder],
    )

    return (
        <SessionTabStrip
            onAdd={onNew}
            extra={extra}
            leadingExtra={leadingExtra}
            remeasureKey={rows.length}
            reorder={reorderable ? {ids: orderedIds, onReorder: handleReorder} : undefined}
            className={className}
        >
            {list.isPending && rows.length === 0
                ? [0, 1].map((i) => <Skeleton key={i} className="mr-1.5 h-7 w-[112px] shrink-0" />)
                : rows.map((vm, index) => (
                      <RailTab
                          key={vm.id}
                          vm={vm}
                          active={vm.id === activeSessionId}
                          divided={
                              index > 0 &&
                              vm.id !== activeSessionId &&
                              rows[index - 1]?.id !== activeSessionId
                          }
                          onSelect={onSelect}
                          draggable={reorderable}
                          onClose={onClose ? () => onClose(vm, orderedIds) : undefined}
                          menuFor={(row) => [
                              ...(menuFor?.(row) ?? []),
                              ...(onClose
                                  ? closeEntries(sessionTabCloseTargets(closeTabs, row.id))
                                  : []),
                              ...(reorderable ? moveEntries(index, rows.length) : []),
                          ]}
                          onMenuSelect={(row, key) => {
                              if (key === MOVE_LEFT || key === MOVE_RIGHT) {
                                  handleReorder(
                                      moved(orderedIds, index, key === MOVE_LEFT ? -1 : 1),
                                  )
                                  return
                              }
                              if (key === CLOSE) {
                                  onClose?.(row, orderedIds)
                                  return
                              }
                              if (key === CLOSE_OTHERS || key === CLOSE_RIGHT) {
                                  const targets = sessionTabCloseTargets(closeTabs, row.id)
                                  onCloseMany?.(
                                      key === CLOSE_OTHERS ? targets.others : targets.toRight,
                                      orderedIds,
                                  )
                                  return
                              }
                              onMenuSelect?.(row, key)
                          }}
                      />
                  ))}
            {!hasActive && !list.isPending ? (
                // Last, and outside the reorder group on purpose: it stands in for a session the
                // list does not hold yet, so it belongs at the end and has no place in an order
                // the list defines.
                <div className="mr-1.5 shrink-0">
                    <SessionTab
                        active
                        label={activeFallbackTitle || "New session"}
                        // Idle, like any session with no run yet — the strip reads as one row of
                        // tabs rather than one tab missing its dot.
                        statusDot={
                            <SimpleTooltip title={IDLE_STATUS.label}>
                                <span
                                    aria-label={IDLE_STATUS.label}
                                    className={clsx(
                                        "h-1.5 w-1.5 shrink-0 rounded-full",
                                        IDLE_STATUS.dotClassName,
                                    )}
                                />
                            </SimpleTooltip>
                        }
                        onSelect={noop}
                    />
                </div>
            ) : null}
        </SessionTabStrip>
    )
}
