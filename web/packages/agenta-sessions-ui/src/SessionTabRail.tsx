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

import {type SessionRowVm} from "@agenta/sessions/row"
import {
    applySessionTabOrder,
    sessionTabOrderAtomFamily,
    setSessionTabOrderAtom,
    useSessionCardList,
    type UseSessionCardListArgs,
} from "@agenta/sessions/state"
import {Skeleton, SimpleTooltip} from "@agenta/ui/ui"
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
}: {
    vm: SessionRowVm
    active: boolean
    onSelect: (vm: SessionRowVm) => void
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /** A drag slot only inside a reorder group — a lone `Reorder.Item` has no context to drag in. */
    draggable: boolean
}) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (active) ref.current?.scrollIntoView({block: "nearest", inline: "nearest"})
    }, [active])
    const handleSelect = useCallback(() => onSelect(vm), [onSelect, vm])

    const chip = (
        <SessionRowContextMenu entries={menuFor?.(vm)} onSelect={(key) => onMenuSelect?.(vm, key)}>
            <SessionTab
                active={active}
                label={vm.title}
                onSelect={handleSelect}
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

    return draggable ? (
        <SessionTabDragItem ref={ref} id={vm.id} className="mr-1.5 shrink-0">
            {chip}
        </SessionTabDragItem>
    ) : (
        <div ref={ref} className="mr-1.5 shrink-0">
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

export const SessionTabRail = ({
    activeSessionId,
    onSelect,
    onNew,
    extra,
    leadingExtra,
    activeFallbackTitle,
    menuFor,
    onMenuSelect,
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
    const orderScope = listArgs.agentId ?? "__project__"
    const savedOrder = useAtomValue(sessionTabOrderAtomFamily(orderScope))
    const setSavedOrder = useSetAtom(setSessionTabOrderAtom)
    const rows = useMemo(() => applySessionTabOrder(listRows, savedOrder), [listRows, savedOrder])
    const hasActive = rows.some((vm) => vm.id === activeSessionId)
    const orderedIds = useMemo(() => rows.map((vm) => vm.id), [rows])
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
            {!hasActive && !list.isPending ? (
                // Outside the reorder group on purpose: it stands in for a session the list does
                // not hold, so it has no place in an order the list defines.
                <div className="mr-1.5 shrink-0">
                    <SessionTab
                        active
                        label={activeFallbackTitle || "This session"}
                        onSelect={noop}
                    />
                </div>
            ) : null}
            {list.isPending && rows.length === 0
                ? [0, 1].map((i) => <Skeleton key={i} className="mr-1.5 h-7 w-[112px] shrink-0" />)
                : rows.map((vm, index) => (
                      <RailTab
                          key={vm.id}
                          vm={vm}
                          active={vm.id === activeSessionId}
                          onSelect={onSelect}
                          draggable={reorderable}
                          menuFor={(row) => [
                              ...(menuFor?.(row) ?? []),
                              ...(reorderable ? moveEntries(index, rows.length) : []),
                          ]}
                          onMenuSelect={(row, key) => {
                              if (key === MOVE_LEFT || key === MOVE_RIGHT) {
                                  handleReorder(
                                      moved(orderedIds, index, key === MOVE_LEFT ? -1 : 1),
                                  )
                                  return
                              }
                              onMenuSelect?.(row, key)
                          }}
                      />
                  ))}
        </SessionTabStrip>
    )
}
