/**
 * THE session tab rail — the horizontal strip of session chips that sits above a conversation, so
 * switching sessions is one tap and the neighbours stay visible.
 *
 * The strip and the chips are the SAME components the desktop playground's tab bar renders
 * (`SessionTabStrip` + `SessionTab`); this adds the one thing that differs — where the tabs come
 * from. WHICH tabs exist is the user's open set; their rows are fetched by id
 * (`useSessionTabRows` → `SessionRowVm`, shared status meta and title precedence), so a session
 * reads the same here as in every list. The card list is consulted only to seed the open set and
 * its order on a first visit — never to decide membership, so a session leaving the sidebar's
 * capped or grouped result (a gate opening, a pin, a newer session) cannot blink its tab out.
 * Only the host's verbs arrive as props: how a chip opens, and what "new" means.
 */
import type {ReactNode} from "react"
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {sessionRowStatusMeta, type SessionRowVm} from "@agenta/sessions/row"
import {
    applySessionTabOrder,
    closeSessionTabsAtom,
    openSessionTabRows,
    sessionTabCloseTargets,
    sessionTabOrderAtomFamily,
    sessionTabScope,
    setSessionTabOrderAtom,
    useOpenSessionTabs,
    usePublishRenderedSessionTabs,
    useSessionCardList,
    useSessionTabOrderSeed,
    useSessionTabRows,
    type SessionTabCloseTargets,
    type UseSessionCardListArgs,
} from "@agenta/sessions/state"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Skeleton, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowLineRightIcon, PencilSimpleIcon, XIcon, XSquareIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import InlineRenameInput from "./InlineRenameInput"
import {type SessionMenuEntry} from "./menu"
import {withShortcutKey} from "./menuShortcut"
import {SessionRowContextMenu} from "./SessionRowContextMenu"
import {SessionTab} from "./SessionTab"
import {SessionTabDragItem} from "./SessionTabDragItem"
import {SessionTabStrip, TAB_DIVIDER} from "./SessionTabStrip"
import {useInlineRename} from "./useInlineRename"

/** A rename asked for from outside the rail (Alt+R) — the tab for this session opens its editor. */
const renameTabRequestAtom = atom<{sessionId: string; nonce: number} | null>(null)

/** Opens a tab's inline rename editor from a surface that does not render the rail. */
export const useRequestSessionTabRename = () => {
    const request = useSetAtom(renameTabRequestAtom)
    return useCallback((sessionId: string) => request({sessionId, nonce: Date.now()}), [request])
}

/** No commit path wired: renaming is off, so the editor never opens to call this. */
const renameUnavailable = async () => false

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
     * Persists a rename. Given this, a tab renames IN PLACE — pencil, double-click, the menu's
     * "Rename" and Alt+R all open the same editor; without it none of them mount.
     */
    onRenameTab?: (vm: SessionRowVm, name: string) => Promise<boolean>
    /**
     * Close one tab. The rail supplies the RENDERED order alongside it, because the survivor a
     * host routes to is defined over what is on screen and only the rail knows that. Omit and no
     * close affordance mounts at all.
     */
    onClose?: (vm: SessionRowVm, ordered: readonly string[]) => void
    /** Close several — "Close other tabs" and "Close tabs to the right". */
    onCloseMany?: (ids: string[], ordered: readonly string[]) => void
    /**
     * Open a session the list does not carry yet — one created here, before it is listed. It has
     * no row view-model, so the host routes from the id alone. Omit and such a chip is inert.
     */
    onSelectUnlisted?: (sessionId: string) => void
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
 * Keeps the active chip in view, scrolling ONLY when it is off-screen — scrolling on every
 * activation yanked the rail back when you clicked a chip you could already see. A just-created
 * session always needs it: its chip is appended last, past the right edge of a full strip.
 */
const useRevealWhenActive = (active: boolean) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!active) return
        const reveal = () => {
            const tab = ref.current
            if (!tab) return
            let scroller: HTMLElement | null = tab.parentElement
            while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowX)) {
                scroller = scroller.parentElement
            }
            if (!scroller) return
            const t = tab.getBoundingClientRect()
            const s = scroller.getBoundingClientRect()
            const delta =
                t.right > s.right ? t.right - s.right : t.left < s.left ? t.left - s.left : 0
            if (delta === 0) return
            // Instant, like the wheel handler: `scroll-smooth` would leave the next frame
            // measuring a rect mid-flight, and the correction below would compound.
            const previous = scroller.style.scrollBehavior
            scroller.style.scrollBehavior = "auto"
            scroller.scrollLeft += delta
            scroller.style.scrollBehavior = previous
        }
        // The strip settles a frame late — the inline New session (+) pins itself once the chips
        // overflow, moving them by its own footprint after the first measure.
        let frame = 0
        let left = 3
        const tick = () => {
            reveal()
            if (--left > 0) frame = requestAnimationFrame(tick)
        }
        tick()
        return () => cancelAnimationFrame(frame)
    }, [active])
    return ref
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
    onRename,
}: {
    vm: SessionRowVm
    active: boolean
    onSelect: (vm: SessionRowVm) => void
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /** Omit where tabs are not closeable — then no × mounts. */
    onClose?: () => void
    /** Omit where tabs are not renameable — then no pencil mounts and no editor opens. */
    onRename?: (name: string) => Promise<boolean>
    /** A drag slot only inside a reorder group — a lone `Reorder.Item` has no context to drag in. */
    draggable: boolean
    /** Hairline before this tab — every tab but the first. */
    divided?: boolean
}) => {
    const ref = useRevealWhenActive(active)
    const handleSelect = useCallback(() => onSelect(vm), [onSelect, vm])
    // The SAME rename machine the session rows use, so Enter/blur commit and Escape abandons here
    // exactly as they do in a list — and the commit lands on the host's one rename path.
    const rename = useInlineRename({current: vm.title, onCommit: onRename ?? renameUnavailable})
    const startRename = rename.start
    // Alt+R is raised outside the rail, so the request arrives as state. The nonce is consumed once.
    const request = useAtomValue(renameTabRequestAtom)
    const consumedNonceRef = useRef<number | null>(null)
    useEffect(() => {
        if (!onRename || request?.sessionId !== vm.id) return
        if (consumedNonceRef.current === request.nonce) return
        consumedNonceRef.current = request.nonce
        startRename()
    }, [onRename, request, startRename, vm.id])
    const handleMenuSelect = useCallback(
        (key: string) => {
            // Deferred, not run here: an input that mounts inside the menu's focus trap is
            // blurred straight back out, and a blur commits. See `useDeferredMenuSelect`.
            if (key === "rename" && onRename) return () => startRename()
            onMenuSelect?.(vm, key)
        },
        [onMenuSelect, onRename, startRename, vm],
    )

    const chip = (
        <SessionRowContextMenu entries={menuFor?.(vm)} onSelect={handleMenuSelect}>
            <SessionTab
                active={active}
                maskLabel={!rename.renaming}
                label={
                    rename.renaming ? (
                        // The editor owns its own events: a click here must not select the tab and
                        // Space/Enter must reach the input, not the chip's activation handler.
                        <span
                            className="block w-full"
                            onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                        >
                            <InlineRenameInput
                                rename={rename}
                                className="h-5 w-full min-w-0 rounded border border-solid border-colorBorder bg-colorBgContainer px-1 text-xs leading-5 text-colorText outline-none [font-family:inherit] focus:border-colorPrimary"
                            />
                        </span>
                    ) : (
                        <span className="block" onDoubleClick={onRename ? startRename : undefined}>
                            {vm.title}
                        </span>
                    )
                }
                onSelect={handleSelect}
                renderActions={
                    onClose || onRename
                        ? () =>
                              rename.renaming ? null : (
                                  <>
                                      {onRename ? (
                                          <button
                                              type="button"
                                              aria-label={`Rename ${vm.title}`}
                                              onClick={(event) => {
                                                  event.stopPropagation()
                                                  startRename()
                                              }}
                                              // Hover-revealed where there IS a hover; on touch the
                                              // chip's actions are always mounted, so it stays visible.
                                              className="text-colorTextTertiary hover:text-colorText flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                                          >
                                              <PencilSimpleIcon size={12} />
                                          </button>
                                      ) : null}
                                      {onClose ? (
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
                                      ) : null}
                                  </>
                              )
                        : undefined
                }
                statusDot={
                    <SimpleTooltip title={vm.status.label}>
                        <span
                            aria-label={vm.status.label}
                            // No pulse: at 6px the fade to half read as a washed-out colour,
                            // not as motion. The hue alone says running / waiting.
                            className={clsx(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                vm.status.dotClassName,
                            )}
                        />
                    </SimpleTooltip>
                }
            />
        </SessionRowContextMenu>
    )

    // 9px = 4px + the 1px divider + 4px, so TAB_DIVIDER lands centred with clearance either side.
    const wrapper = clsx("mr-2.25 shrink-0", divided && TAB_DIVIDER)
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
    {
        key: CLOSE,
        label: withShortcutKey("Close", "session.close"),
        icon: <XIcon size={14} />,
        disabled: !targets.closable,
    },
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

/** The pending tab has no stream yet, so it wears the same idle chrome every quiet row does. */
const IDLE_STATUS = sessionRowStatusMeta("idle")

/**
 * A session held open whose row has not landed yet — a session created here, before the by-id
 * fetch sees it. There is no row view-model behind it, so it offers no menu and no rename; closing
 * goes through the host's bulk close so the active chip can go too (the host routes to a survivor).
 */
const UnlistedTab = ({
    id,
    title,
    active,
    divided,
    onSelect,
    onClose,
}: {
    id: string
    title: string
    active: boolean
    divided?: boolean
    onSelect?: (sessionId: string) => void
    onClose?: () => void
}) => {
    const ref = useRevealWhenActive(active)
    return (
        <div ref={ref} className={clsx("mr-2.25 shrink-0", divided && TAB_DIVIDER)}>
            <SessionTab
                active={active}
                label={title}
                onSelect={() => onSelect?.(id)}
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
                renderActions={
                    onClose
                        ? () => (
                              <button
                                  type="button"
                                  aria-label={`Close ${title}`}
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
            />
        </div>
    )
}

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
    onSelectUnlisted,
    onRenameTab,
    reorderable = true,
    className,
    ...listArgs
}: SessionTabRailProps) => {
    // The card list seeds a first visit — which tabs start open, and in what order. It decides
    // nothing after that; the sidebar shares this query, so it costs no extra request.
    const list = useSessionCardList(listArgs)
    const listedIds = useMemo(
        () => list.groups.flatMap((group) => group.rows.map((vm) => vm.id)),
        [list.groups],
    )
    // A rail is arranged by hand, so the user's order wins over the list's. Scoped to the agent
    // whose sessions these are — arranging one agent's rail says nothing about another's.
    const orderScope = sessionTabScope(listArgs.agentId)
    const savedOrder = useAtomValue(sessionTabOrderAtomFamily(orderScope))
    const setSavedOrder = useSetAtom(setSessionTabOrderAtom)
    // Rank every session the list carries, open or not, so reopening one restores its old slot.
    useSessionTabOrderSeed(orderScope, listedIds)
    // Membership is the user's own: tabs are an explicit set here, not a view of the server list.
    const openIds = useOpenSessionTabs(orderScope, listedIds, activeSessionId)
    // Rows for exactly that set, by id — see the header for why not the list's rows.
    const tabs = useSessionTabRows({
        policy: listArgs.policy,
        agentId: listArgs.agentId,
        ids: openIds,
    })
    const arranged = useMemo(
        () => applySessionTabOrder(tabs.rows, savedOrder),
        [tabs.rows, savedOrder],
    )
    // Still filtered: a by-id page can lag the open set by one fetch after a close.
    const rows = useMemo(
        () => openSessionTabRows(arranged, openIds, activeSessionId),
        [arranged, openIds, activeSessionId],
    )
    const fetchedIds = useMemo(() => tabs.rows.map((vm) => vm.id), [tabs.rows])
    const hasActive = rows.some((vm) => vm.id === activeSessionId)
    // Sessions open here whose row has not landed — chiefly one just created, which the by-id
    // fetch sees only after it is opened. The rail renders them itself, so navigating away no
    // longer takes the new tab with it.
    const [unlisted, setUnlisted] = useState<{id: string; title: string}[]>([])
    const closeOpenTabs = useSetAtom(closeSessionTabsAtom)
    useEffect(() => {
        if (tabs.isPending || hasActive || !activeSessionId) return
        setUnlisted((prev) =>
            prev.some((tab) => tab.id === activeSessionId)
                ? prev
                : [...prev, {id: activeSessionId, title: activeFallbackTitle || "New session"}],
        )
    }, [activeFallbackTitle, activeSessionId, hasActive, tabs.isPending])
    // Let one go the moment its row lands, or the tab is closed.
    useEffect(() => {
        setUnlisted((prev) => {
            const next = prev.filter(
                (tab) => !fetchedIds.includes(tab.id) && (openIds?.includes(tab.id) ?? true),
            )
            return next.length === prev.length ? prev : next
        })
    }, [fetchedIds, openIds])
    const orderedIds = useMemo(() => rows.map((vm) => vm.id), [rows])
    // Everything on the strip, in rendered order — unlisted chips trail the rows. This is the
    // order a close reads its survivor from, so closing an unlisted chip lands somewhere too.
    const renderedIds = useMemo(
        () => [...orderedIds, ...unlisted.map((tab) => tab.id)],
        [orderedIds, unlisted],
    )
    // Published so a keyboard surface outside the rail can address "the Nth tab".
    usePublishRenderedSessionTabs(orderScope, renderedIds)
    const closeTabs = useMemo(
        () => [
            ...rows.map((vm) => ({id: vm.id, pinned: vm.isPinned})),
            ...unlisted.map((tab) => ({id: tab.id, pinned: false})),
        ],
        [rows, unlisted],
    )
    // The last chip stays: closing it would leave the surface with nothing to show.
    const closable = renderedIds.length > 1
    // Persist the WHOLE visible order on every drop, so sessions the saved order had never seen are
    // captured by the first arrangement that touches them.
    const handleReorder = useCallback(
        (ids: string[]) => setSavedOrder({scope: orderScope, ids}),
        [orderScope, setSavedOrder],
    )

    return (
        <SessionTabStrip
            onAdd={onNew}
            addTooltip={
                <span className="flex items-center gap-1.5">
                    New session <ShortcutKeys id="session.new" tone="inverse" />
                </span>
            }
            extra={extra}
            leadingExtra={leadingExtra}
            remeasureKey={rows.length}
            reorder={reorderable ? {ids: orderedIds, onReorder: handleReorder} : undefined}
            className={className}
        >
            {tabs.isPending && rows.length === 0
                ? [0, 1].map((i) => <Skeleton key={i} className="mr-2.25 h-7 w-28 shrink-0" />)
                : rows.map((vm, index) => (
                      <RailTab
                          key={vm.id}
                          vm={vm}
                          active={vm.id === activeSessionId}
                          divided={index > 0}
                          onSelect={onSelect}
                          draggable={reorderable}
                          onClose={onClose && closable ? () => onClose(vm, renderedIds) : undefined}
                          onRename={onRenameTab ? (name) => onRenameTab(vm, name) : undefined}
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
                                  onClose?.(row, renderedIds)
                                  return
                              }
                              if (key === CLOSE_OTHERS || key === CLOSE_RIGHT) {
                                  const targets = sessionTabCloseTargets(closeTabs, row.id)
                                  onCloseMany?.(
                                      key === CLOSE_OTHERS ? targets.others : targets.toRight,
                                      renderedIds,
                                  )
                                  return
                              }
                              onMenuSelect?.(row, key)
                          }}
                      />
                  ))}
            {tabs.isPending
                ? null
                : unlisted.map((tab, index) => (
                      <UnlistedTab
                          key={tab.id}
                          id={tab.id}
                          title={tab.title}
                          active={tab.id === activeSessionId}
                          divided={rows.length > 0 || index > 0}
                          onSelect={onSelectUnlisted}
                          // The host owns where a close lands, so it takes the active chip's
                          // close; without a host handler only a chip you are not on can go.
                          onClose={
                              !closable
                                  ? undefined
                                  : onCloseMany
                                    ? () => onCloseMany([tab.id], renderedIds)
                                    : tab.id === activeSessionId
                                      ? undefined
                                      : () => closeOpenTabs({scope: orderScope, ids: [tab.id]})
                          }
                      />
                  ))}
        </SessionTabStrip>
    )
}
