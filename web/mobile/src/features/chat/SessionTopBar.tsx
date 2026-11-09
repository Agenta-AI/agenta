import {
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type RefObject,
} from "react"

import {phoneViewportAtom} from "@agenta/chat/state"
import {workflowMolecule} from "@agenta/entities/workflow"
import {FilesPaneToggle, useSessionFilesPane} from "@agenta/entity-ui/drive"
import {AgentPageHeader, AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {sessionRowVm} from "@agenta/sessions/row"
import {KeyboardShortcutsSheet, ShortcutKeys, useShortcutsSheetHotkey} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {NotePencilIcon, PlusIcon} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {sharingCopy} from "@/lib/sharingCopy"

import {NavDrawer} from "../nav/NavDrawer"

import {ConfigPaneToggle} from "./ConfigPaneToggle"
import {heldCommitAtomFamily} from "./selectedRevision"
import {SessionAgentIdentity} from "./SessionAgentIdentity"
import {sessionBarPanelAtom} from "./sessionBarState"
import {SessionMoreMenu} from "./SessionMoreMenu"
import {SessionSharingControl} from "./SessionSharingControl"
import {SessionSwitcher} from "./SessionSwitcher"
import {ShareMenu} from "./ShareMenu"
import {useSessionHeader} from "./useSessionHeader"
import {useStartBlankSession} from "./useStartBlankSession"

type FoldedShare = ("share" | "publish")[]
const NONE: FoldedShare = []
/** The order buttons leave the bar when the tabs need the room. */
const FOLD_STEPS: FoldedShare[] = [NONE, ["publish"], ["publish", "share"]]
/** Grid gap between the bar's columns (`sm:gap-4`). */
const COLUMN_GAP = 16

/** Span of an element's laid-out children: its content width, whatever its own box is. */
const contentWidth = (el: Element | null | undefined): number => {
    const boxes = Array.from(el?.children ?? [])
        .map((child) => child.getBoundingClientRect())
        .filter((box) => box.width > 0)
    if (boxes.length === 0) return 0
    return Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left))
}

/** Content width with truncated labels at full length: the laid-out one depends on the choice. */
const naturalWidth = (el: Element | null | undefined): number => {
    const clipped: HTMLElement[] = []
    for (const node of Array.from(el?.querySelectorAll<HTMLElement>("*") ?? [])) {
        if (clipped.some((outer) => outer.contains(node))) continue
        if (
            node.scrollWidth > node.clientWidth + 1 &&
            getComputedStyle(node).overflowX !== "visible"
        ) {
            clipped.push(node)
        }
    }
    return clipped.reduce(
        (sum, node) => sum + node.scrollWidth - node.clientWidth,
        contentWidth(el),
    )
}

/**
 * Which of Share and Publish the bar folds into ⋯, and whether the tabs centre or start left.
 * Buttons fold one at a time and only when the tabs would otherwise meet them; with room to
 * spare both stay. Measured against what the bar would need with every button in place, so a
 * fold never feeds back into the next decision.
 */
const useBarFit = (
    barRef: RefObject<HTMLDivElement | null>,
    stripWidth: number,
    preferCenter: boolean,
) => {
    const [fit, setFit] = useState<{folded: FoldedShare; center: boolean}>({
        folded: NONE,
        center: preferCenter,
    })
    // Last-seen footprints, so a folded button still counts; Share's includes its divider and gaps.
    const seen = useRef({shareTail: 101, publish: 84})
    useLayoutEffect(() => {
        const bar = barRef.current
        const grid = bar?.firstElementChild
        if (!bar || !grid || stripWidth === 0) return
        const measure = () => {
            const shareButton = grid.querySelector('[data-testid="share-menu-share"]')
            const publishButton = grid.querySelector('[data-testid="share-menu-publish"]')
            const tools = grid.querySelector("[data-bar-tools]")?.getBoundingClientRect().width ?? 0
            // No share menu (no agent, or it is hidden): nothing to fold, so nothing to count.
            const canShare = Boolean(grid.querySelector("[data-share-menu]"))
            if (publishButton) seen.current.publish = publishButton.getBoundingClientRect().width
            if (shareButton) {
                seen.current.shareTail =
                    contentWidth(grid.lastElementChild) -
                    tools -
                    (publishButton ? seen.current.publish : 0)
            }
            const room = grid.clientWidth - 20
            const left = naturalWidth(grid.firstElementChild)
            const rightFor = (folded: FoldedShare) =>
                tools +
                (!canShare || folded.includes("share") ? 0 : seen.current.shareTail) +
                (!canShare || folded.includes("publish") ? 0 : seen.current.publish)
            const fits = (folded: FoldedShare, center: boolean) => {
                const right = rightFor(folded)
                return center
                    ? stripWidth + 2 * Math.max(left, right) + 2 * COLUMN_GAP <= room
                    : left + stripWidth + right + COLUMN_GAP <= room
            }
            const tries = preferCenter ? [true, false] : [false]
            for (const center of tries) {
                const folded = FOLD_STEPS.find((step) => fits(step, center))
                if (folded) return {folded, center}
            }
            // No room even with both folded: the strip itself narrows and scrolls.
            return {folded: FOLD_STEPS[FOLD_STEPS.length - 1], center: false}
        }
        const apply = () => {
            const next = measure()
            setFit((prev) =>
                prev.center === next.center && prev.folded.join() === next.folded.join()
                    ? prev
                    : next,
            )
        }
        apply()
        const ro = new ResizeObserver(apply)
        ro.observe(bar)
        // The side groups too: a button that lands late (Publish) widens them, not the bar.
        const observeSides = () => {
            for (const side of [grid.firstElementChild, grid.lastElementChild]) {
                for (const child of Array.from(side?.children ?? [])) ro.observe(child)
            }
        }
        observeSides()
        const mo = new MutationObserver(() => {
            observeSides()
            apply()
        })
        for (const side of [grid.firstElementChild, grid.lastElementChild]) {
            if (side) mo.observe(side, {childList: true})
        }
        return () => {
            mo.disconnect()
            ro.disconnect()
        }
    }, [barRef, stripWidth, preferCenter])
    return fit
}

/**
 * The session workspace's bar: which session, and what you can do with it. On a desktop it spans
 * the session column only; side panes run the full height beside it. The agent shows here unless
 * the open config pane shows it at its own top.
 *
 * No Build/Chat switch: the config pane is shown or collapsed, and that is the whole model.
 */
const SessionTopBarView = ({
    entityId,
    sessionId,
    onUpdate,
    agentId,
    agentResolving = false,
    agentHidden = false,
    canSend = true,
    hasSessions,
    workspaceId,
    projectId,
    identityInPane = false,
    configOpen = false,
    onToggleConfig,
    onShowConfig,
}: {
    /** The revision under edit. Absent = a session with no turns yet (nothing committed to show). */
    entityId: string | null
    /** The session on screen. */
    sessionId: string
    /** Pin this session to a newer version the user asked for. */
    onUpdate: (revisionId: string) => void
    agentId?: string | null
    /** A null `agentId` is not yet the answer. */
    agentResolving?: boolean
    /** A private agent the reader cannot see: a lock and "Private agent", nothing to act on. */
    agentHidden?: boolean
    /** False when the reader may not send here: no template requests (they send a message). */
    canSend?: boolean
    /** False on first run: one draft session, so no switcher and no session controls. */
    hasSessions: boolean
    workspaceId: string
    projectId: string
    /** Desktop with the config pane open: the agent shows atop that pane, not in the bar. */
    identityInPane?: boolean
    /** Phone: the config pane is on screen in the chat's place. */
    configOpen?: boolean
    /** Phone: shows or hides the config pane; the bar's toggle is absent without it. */
    onToggleConfig?: () => void
    /** Opens the closed config pane; its button leads the bar. */
    onShowConfig?: () => void
}) => {
    // Seeded at load, unlike a media query, so the first paint already has the right layout.
    const phone = useAtomValue(phoneViewportAtom)
    // artifactName resolves from a revision id or a workflow id, so either handle names the agent.
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId ?? agentId ?? ""))
    const agentName = agentHidden ? sharingCopy.privateAgent : name || "Agent"
    // A commit the session held back (unsaved config edits) is a reason to check for a newer
    // version now, so the status offers it at once.
    const heldCommit = useAtomValue(heldCommitAtomFamily(sessionId))
    const stream = useSessionHeader(projectId, sessionId).data ?? null
    const sessionName = stream
        ? sessionRowVm(stream, {pinned: false, pending: undefined}).title
        : "New session"
    const startBlank = useStartBlankSession(`/w/${workspaceId}/p/${projectId}`)

    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    const openShortcuts = useCallback(() => setShortcutsOpen(true), [])
    useShortcutsSheetHotkey(openShortcuts)

    // A panel belongs to the session it was opened on.
    const setPanel = useSetAtom(sessionBarPanelAtom)
    useEffect(() => () => setPanel(null), [sessionId, setPanel])

    const {open: filesOpen, toggle: toggleFiles} = useSessionFilesPane(
        agentId ?? sessionId,
        sessionId,
    )
    // The bar's own width decides whether Share and Publish fit beside the tabs.
    const barRef = useRef<HTMLDivElement>(null)
    const [stripWidth, setStripWidth] = useState(0)
    const fit = useBarFit(barRef, stripWidth, !identityInPane)
    const foldedShare = phone ? NONE : fit.folded
    const shareFolded = foldedShare.includes("share")

    const revision =
        entityId && !agentHidden ? (
            <AgentRevisionStatus
                revisionId={entityId}
                historyWorkflowId={agentId}
                onUpdate={onUpdate}
                checkKey={heldCommit ? `${sessionId}:${heldCommit}` : sessionId}
                hideWhenSettled
            />
        ) : undefined

    const switcher = hasSessions ? (
        <SessionSwitcher
            sessionId={sessionId}
            agentId={agentId}
            agentResolving={agentResolving}
            agentName={agentName}
            agentHidden={agentHidden}
            workspaceId={workspaceId}
            projectId={projectId}
            phone={phone}
            align={fit.center ? "center" : "start"}
            onStripNaturalWidth={setStripWidth}
        />
    ) : null

    const more = (
        <SessionMoreMenu
            sessionId={sessionId}
            entityId={entityId}
            agentId={agentId}
            agentName={agentName}
            agentHidden={agentHidden}
            hasSessions={hasSessions}
            projectId={projectId}
            phone={phone}
            // Folded one by one, only when the tabs would meet them.
            foldedShare={foldedShare}
            onOpenShortcuts={openShortcuts}
        />
    )

    const share =
        agentId && !agentHidden ? (
            <ShareMenu
                agentId={agentId}
                sessionId={sessionId}
                sessionName={sessionName}
                showSession={hasSessions}
                // No revision = read-only replay: no conversation to send into.
                canRequestTemplate={Boolean(entityId) && canSend}
                workspaceId={workspaceId}
                projectId={projectId}
                phone={phone}
                folded={foldedShare}
            />
        ) : hasSessions ? (
            <SessionSharingControl
                sessionId={sessionId}
                sessionName={sessionName}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
            />
        ) : null

    const shortcuts = (
        <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    )

    if (phone) {
        return (
            <header className="flex h-12 shrink-0 items-center gap-0.5 border-x-0 border-b border-t-0 border-solid border-[var(--ag-shell-line)] bg-[var(--ag-surface-raised)] px-1.5">
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                {switcher ?? (
                    <span className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold">
                        {agentName}
                    </span>
                )}
                {revision}
                {onToggleConfig ? (
                    <ConfigPaneToggle open={configOpen} onToggle={onToggleConfig} size="icon" />
                ) : null}
                {hasSessions && agentId ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="New session"
                        onClick={() => startBlank(agentId)}
                    >
                        <PlusIcon />
                    </Button>
                ) : null}
                {more}
                {share}
                {shortcuts}
            </header>
        )
    }

    return (
        <div ref={barRef} className="min-w-0 shrink-0">
            <AgentPageHeader
                centerAlign={fit.center ? "center" : "start"}
                // Tabs set the bar's height; without them it keeps the 48px row.
                className={switcher ? undefined : "md:min-h-12"}
                tabbed={Boolean(switcher)}
                // Nav is the drawer below `lg`; it hides itself where the rail takes over.
                // With the config pane open, the menu leads that pane's header at the window's edge.
                leading={
                    identityInPane ? undefined : (
                        <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                    )
                }
                identity={
                    // The open config pane shows the agent at its own top.
                    identityInPane ? undefined : (
                        <div className="flex min-w-0 items-center gap-1.5">
                            {onShowConfig ? (
                                <ConfigPaneToggle open={false} onToggle={onShowConfig} />
                            ) : null}
                            <SessionAgentIdentity
                                entityId={entityId}
                                sessionId={sessionId}
                                agentId={agentId}
                                agentHidden={agentHidden}
                                onUpdate={onUpdate}
                                // The Files pane takes the bar's room; the tabs keep it.
                                iconOnly={hasSessions && filesOpen}
                            />
                        </div>
                    )
                }
                center={switcher}
                actions={
                    <>
                        {/* The session tools sit tight as one group. */}
                        <div data-bar-tools className="flex items-center gap-0.5">
                            {hasSessions && agentId ? (
                                <SimpleTooltip
                                    title={
                                        <span className="flex items-center gap-1.5">
                                            New session{" "}
                                            <ShortcutKeys id="session.new" tone="inverse" />
                                        </span>
                                    }
                                >
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="New session"
                                        onClick={() => startBlank(agentId)}
                                    >
                                        <NotePencilIcon />
                                    </Button>
                                </SimpleTooltip>
                            ) : null}
                            {hasSessions ? (
                                <FilesPaneToggle open={filesOpen} onToggle={toggleFiles} />
                            ) : null}
                            {more}
                        </div>
                        {/* Separates the session's tools from the agent's sharing; gone with them. */}
                        {agentId && !agentHidden && !shareFolded ? (
                            <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" />
                        ) : null}
                        {share}
                        {shortcuts}
                    </>
                }
            />
        </div>
    )
}

/** Memoized: a pane slide re-renders the workspace around it. */
export const SessionTopBar = memo(SessionTopBarView)
