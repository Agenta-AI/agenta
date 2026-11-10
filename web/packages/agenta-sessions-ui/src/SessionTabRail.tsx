/**
 * THE session tab rail — the horizontal strip of session chips in the session bar, so
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
import {useCallback, useEffect, useMemo, useState} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"
import {
    applySessionTabOrder,
    closeSessionTabsAtom,
    openSessionTabRows,
    sessionTabCloseTargets,
    sessionTabOrderAtomFamily,
    sessionTabScope,
    useOpenSessionTabs,
    usePublishRenderedSessionTabs,
    useSessionCardList,
    useSessionTabOrderSeed,
    useSessionTabRows,
    type UseSessionCardListArgs,
} from "@agenta/sessions/state"
import {SimpleTooltip, SkeletonBlock} from "@agenta/ui/ui"
import {XIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"

import InlineRenameInput from "./InlineRenameInput"
import {type SessionMenuEntry} from "./menu"
import {
    CLOSE,
    CLOSE_OTHERS,
    CLOSE_RIGHT,
    closeEntries,
    unlistedTabCloseIds,
    unlistedTabMenu,
} from "./railTabMenu"
import {SessionRowContextMenu} from "./SessionRowContextMenu"
import {SessionTab} from "./SessionTab"
import {SessionTabStrip} from "./SessionTabStrip"
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
    /** False for a tab the reader may not rename (someone else's chat): no pencil, no editor. */
    canRenameTab?: (vm: SessionRowVm) => boolean
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
    /** See `SessionTabStrip.onNaturalWidth`. */
    onStripNaturalWidth?: (width: number) => void
    className?: string
}

/** Only states that ask for a look earn a dot on a page tab; a quiet session shows its name alone. */
const TAB_DOT_STATUSES = new Set(["waiting", "running"])

/** The chat's live-text sweep (`text-shimmer`), so a running tab reads like a live turn. */
const RUNNING_TITLE =
    "bg-[linear-gradient(90deg,var(--ag-colorTextQuaternary)_0%,var(--ag-colorText)_50%,var(--ag-colorTextQuaternary)_100%)] bg-clip-text motion-safe:animate-text-shimmer motion-safe:bg-[length:200%_100%] motion-safe:text-transparent"

/** A tab's slot in the strip; `data-tab-id` lets the strip tell a new open tab from a remount. */
const TAB_SLOT = "mr-0.5 shrink-0"

/** A row as a page tab: the shared `SessionTab`, with its status dot from the row view-model. */
const RailTab = ({
    vm,
    active,
    onSelect,
    menuFor,
    onMenuSelect,
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
}) => {
    // A running tab beeps and its name shimmers, like the chat's live "Thinking" line.
    const running = vm.status.status === "running"
    const handleSelect = useCallback(() => onSelect(vm), [onSelect, vm])
    // The SAME rename machine the session rows use, so Enter/blur commit and Escape abandons here
    // exactly as they do in a list — and the commit lands on the host's one rename path.
    const rename = useInlineRename({current: vm.title, onCommit: onRename ?? renameUnavailable})
    const startRename = rename.start
    // Alt+R is raised outside the rail, so the request arrives as state. The nonce is consumed once.
    const [request, setRequest] = useAtom(renameTabRequestAtom)
    useEffect(() => {
        if (!onRename || request?.sessionId !== vm.id) return
        // Cleared, or the next mount of this tab would open its editor again.
        setRequest(null)
        startRename()
    }, [onRename, request, setRequest, startRename, vm.id])
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
                connected
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
                        <span
                            className={clsx("block", running && RUNNING_TITLE)}
                            onDoubleClick={onRename ? startRename : undefined}
                        >
                            {vm.title}
                        </span>
                    )
                }
                onSelect={handleSelect}
                renderActions={
                    onClose
                        ? () =>
                              rename.renaming ? null : (
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
                    !TAB_DOT_STATUSES.has(vm.status.status) ? undefined : (
                        <SimpleTooltip title={vm.status.label}>
                            {running ? (
                                // A tab that is running beeps: an ink dot with a ring that fades out.
                                <span
                                    aria-label={vm.status.label}
                                    className="relative flex h-1.5 w-1.5 shrink-0"
                                >
                                    <span className="absolute inset-0 rounded-full bg-colorText opacity-60 motion-safe:animate-ping" />
                                    <span className="relative h-1.5 w-1.5 rounded-full bg-colorText" />
                                </span>
                            ) : (
                                <span
                                    aria-label={vm.status.label}
                                    className={clsx(
                                        "h-1.5 w-1.5 shrink-0 rounded-full",
                                        vm.status.dotClassName,
                                    )}
                                />
                            )}
                        </SimpleTooltip>
                    )
                }
            />
        </SessionRowContextMenu>
    )

    return (
        <div data-tab-id={vm.id} className={TAB_SLOT}>
            {chip}
        </div>
    )
}

/** How long a clicked tab may show as open before the route confirms it. */
const PICK_TIMEOUT_MS = 3000

/** A strip entry: a listed row, or a session open here whose row has not landed. */
type StripItem = {id: string; vm: SessionRowVm} | {id: string; tab: {id: string; title: string}}
/** Title-line widths for the page-tab skeleton, near what real session names measure. */
const SKELETON_TAB_TITLES = ["w-24", "w-14", "w-20"]

/**
 * A session held open whose row has not landed yet — a session created here, before the by-id
 * fetch sees it. There is no row view-model behind it, so the server verbs (rename, archive,
 * pin) are off the table; the TAB verbs are not, and a chip with no menu at all read as the menu
 * being broken (#6379). Closing goes through the host's bulk close so the active chip can go too.
 */
const UnlistedTab = ({
    id,
    title,
    active,
    onSelect,
    onClose,
    menu,
    onMenuSelect,
}: {
    id: string
    title: string
    active: boolean
    onSelect?: (sessionId: string) => void
    onClose?: () => void
    menu?: SessionMenuEntry[]
    onMenuSelect?: (key: string) => void
}) => {
    return (
        <div data-tab-id={id} className={TAB_SLOT}>
            <SessionRowContextMenu entries={menu} onSelect={onMenuSelect}>
                <SessionTab
                    active={active}
                    connected
                    label={title}
                    onSelect={() => onSelect?.(id)}
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
            </SessionRowContextMenu>
        </div>
    )
}

export const SessionTabRail = ({
    activeSessionId,
    onSelect,
    activeFallbackTitle,
    menuFor,
    onMenuSelect,
    onClose,
    onCloseMany,
    onSelectUnlisted,
    onRenameTab,
    canRenameTab,
    onStripNaturalWidth,
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
    // Each tab keeps its first slot, so a turn never reshuffles them (#6544); per agent.
    const orderScope = sessionTabScope(listArgs.agentId)
    const savedOrder = useAtomValue(sessionTabOrderAtomFamily(orderScope))
    // Membership is the user's own: tabs are an explicit set here, not a view of the server list.
    const openIds = useOpenSessionTabs(orderScope, listedIds, activeSessionId)
    // Listed and open ids alike, so a new session is ranked when it opens, not when it is listed.
    const seedIds = useMemo(() => {
        const listed = new Set(listedIds)
        return [...listedIds, ...(openIds ?? []).filter((id) => !listed.has(id))]
    }, [listedIds, openIds])
    useSessionTabOrderSeed(orderScope, seedIds)
    // Rows for exactly that set, by id — see the header for why not the list's rows.
    const tabs = useSessionTabRows({
        policy: listArgs.policy,
        agentId: listArgs.agentId,
        ids: openIds,
        // The rail's own reads share the card's priority — its host decides (see the card list).
        lowPriority: listArgs.lowPriority,
    })
    // Still filtered: a by-id page can lag the open set by one fetch after a close.
    const rows = useMemo(
        () => openSessionTabRows(tabs.rows, openIds, activeSessionId),
        [tabs.rows, openIds, activeSessionId],
    )
    const fetchedIds = useMemo(() => tabs.rows.map((vm) => vm.id), [tabs.rows])
    const hasActive = rows.some((vm) => vm.id === activeSessionId)
    // Sessions open here whose row has not landed — chiefly one just created, which the by-id
    // fetch sees only after it is opened. The rail renders them itself, so navigating away no
    // longer takes the new tab with it.
    const [unlisted, setUnlisted] = useState<{id: string; title: string}[]>([])
    const closeOpenTabs = useSetAtom(closeSessionTabsAtom)
    // Waits for the open set to hold the active id: on an agent switch the set is seeded from the
    // list first and the active id joins a commit later, and the trim below drops a chip whose
    // id is not open yet. Adding it before that point lost the chip for good, since nothing here
    // re-ran once the id was added — the "New session" tab was missing after every agent switch.
    const activeOpen = openIds === null || openIds.includes(activeSessionId)
    useEffect(() => {
        if (tabs.isPending || hasActive || !activeSessionId || !activeOpen) return
        setUnlisted((prev) =>
            prev.some((tab) => tab.id === activeSessionId)
                ? prev
                : [...prev, {id: activeSessionId, title: activeFallbackTitle || "New session"}],
        )
    }, [activeFallbackTitle, activeSessionId, activeOpen, hasActive, tabs.isPending])
    // Let one go the moment its row lands, or the tab is closed.
    useEffect(() => {
        setUnlisted((prev) => {
            const next = prev.filter(
                (tab) => !fetchedIds.includes(tab.id) && (openIds?.includes(tab.id) ?? true),
            )
            return next.length === prev.length ? prev : next
        })
    }, [fetchedIds, openIds])
    // The effect above trims state a commit late; the commit a row lands in must not draw the
    // chip twice, so what renders is derived here, synchronously.
    const visibleUnlisted = useMemo(
        () => unlisted.filter((tab) => !fetchedIds.includes(tab.id)),
        [unlisted, fetchedIds],
    )
    // The clicked tab shows as open at once; the route catches up a few hundred ms later. A
    // switch that waited on it read as lag before the surface even moved.
    const [pickedId, setPickedId] = useState<string | null>(null)
    useEffect(() => {
        if (!pickedId) return
        if (pickedId === activeSessionId) {
            setPickedId(null)
            return
        }
        // A navigation that never lands gives the tab back to the route.
        const timer = setTimeout(() => setPickedId(null), PICK_TIMEOUT_MS)
        return () => clearTimeout(timer)
    }, [pickedId, activeSessionId])
    const shownActiveId = pickedId ?? activeSessionId
    const selectTab = useCallback(
        (vm: SessionRowVm) => {
            setPickedId(vm.id)
            onSelect(vm)
        },
        [onSelect],
    )
    const selectUnlistedTab = useCallback(
        (id: string) => {
            setPickedId(id)
            onSelectUnlisted?.(id)
        },
        [onSelectUnlisted],
    )
    // Listed rows and unlisted chips in ONE order; a close also reads its survivor from it.
    const stripItems = useMemo(
        () =>
            applySessionTabOrder<StripItem>(
                [
                    ...rows.map((vm) => ({id: vm.id, vm})),
                    ...(tabs.isPending ? [] : visibleUnlisted.map((tab) => ({id: tab.id, tab}))),
                ],
                savedOrder,
            ),
        [rows, visibleUnlisted, tabs.isPending, savedOrder],
    )
    const renderedIds = useMemo(() => stripItems.map((item) => item.id), [stripItems])
    // Published so a keyboard surface outside the rail can address "the Nth tab".
    usePublishRenderedSessionTabs(orderScope, renderedIds)
    const closeTabs = useMemo(
        () =>
            stripItems.map((item) => ({
                id: item.id,
                pinned: "vm" in item ? item.vm.isPinned : false,
            })),
        [stripItems],
    )
    // The last chip stays: closing it would leave the surface with nothing to show.
    const closable = renderedIds.length > 1

    return (
        <SessionTabStrip
            bare
            fitTabs={3}
            onNaturalWidth={onStripNaturalWidth}
            className={className}
        >
            {tabs.isPending && rows.length === 0
                ? // The real tab's box with a title line, the first on the open tab's surface.
                  SKELETON_TAB_TITLES.map((width, index) => (
                      <div
                          key={width}
                          aria-hidden
                          className={clsx(
                              "mr-0.5 flex h-8 shrink-0 items-center rounded-t-[6px] px-3",
                              index === 0 && "bg-background",
                          )}
                      >
                          <SkeletonBlock active className={clsx("h-3 rounded", width)} />
                      </div>
                  ))
                : stripItems.map((item) => {
                      if ("vm" in item) {
                          const vm = item.vm
                          return (
                              <RailTab
                                  key={vm.id}
                                  vm={vm}
                                  active={vm.id === shownActiveId}
                                  onSelect={selectTab}
                                  onClose={
                                      onClose && closable
                                          ? () => onClose(vm, renderedIds)
                                          : undefined
                                  }
                                  onRename={
                                      onRenameTab && (canRenameTab?.(vm) ?? true)
                                          ? (name) => onRenameTab(vm, name)
                                          : undefined
                                  }
                                  menuFor={(row) => [
                                      ...(menuFor?.(row) ?? []),
                                      ...(onClose
                                          ? closeEntries(sessionTabCloseTargets(closeTabs, row.id))
                                          : []),
                                  ]}
                                  onMenuSelect={(row, key) => {
                                      if (key === CLOSE) {
                                          onClose?.(row, renderedIds)
                                          return
                                      }
                                      if (key === CLOSE_OTHERS || key === CLOSE_RIGHT) {
                                          const targets = sessionTabCloseTargets(closeTabs, row.id)
                                          onCloseMany?.(
                                              key === CLOSE_OTHERS
                                                  ? targets.others
                                                  : targets.toRight,
                                              renderedIds,
                                          )
                                          return
                                      }
                                      onMenuSelect?.(row, key)
                                  }}
                              />
                          )
                      }
                      const tab = item.tab
                      return (
                          <UnlistedTab
                              key={tab.id}
                              id={tab.id}
                              title={tab.title}
                              active={tab.id === shownActiveId}
                              onSelect={selectUnlistedTab}
                              // Only the tab verbs, and only when the host can land a close.
                              menu={onCloseMany ? unlistedTabMenu(closeTabs, tab.id) : undefined}
                              onMenuSelect={(key) => {
                                  const ids = unlistedTabCloseIds(key, closeTabs, tab.id)
                                  if (ids) onCloseMany?.(ids, renderedIds)
                              }}
                              // The host owns where a close lands, so it takes the active chip's
                              // close; without a host handler only a chip you are not on can go.
                              onClose={
                                  !closable
                                      ? undefined
                                      : onCloseMany
                                        ? () => onCloseMany([tab.id], renderedIds)
                                        : tab.id === activeSessionId
                                          ? undefined
                                          : () =>
                                                closeOpenTabs({
                                                    scope: orderScope,
                                                    ids: [tab.id],
                                                })
                              }
                          />
                      )
                  })}
        </SessionTabStrip>
    )
}
