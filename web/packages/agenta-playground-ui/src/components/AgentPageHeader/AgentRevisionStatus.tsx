import {useEffect, useId, useRef, useState} from "react"

import {revalidateAgentRevisionReads, workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import headerCatalog from "@agenta/i18n/catalogs/playground.agentHeader"
import revisionStatusCatalog from "@agenta/i18n/catalogs/playground.revisionStatus"
import {
    agentAutoCommitErrorAtomFamily,
    agentAutoCommitScheduledAtomFamily,
    agentAutoCommitStatusAtomFamily,
    flushAgentAutoCommitAtom,
    watchLatestVersion,
    type LatestVersion,
} from "@agenta/playground/state"
import {projectIdAtom} from "@agenta/shared/state"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ClockCounterClockwise, WarningCircle} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai-family"
import dynamic from "next/dynamic"

import {openAgentVersionHistoryAtom, versionHistoryOpenAtomFamily} from "../AgentVersionHistory"

const SAVED_FLASH_MS = 2000

// Mounted only once opened: the drawer pulls the whole revision list and diff machinery.
const AgentVersionHistoryDrawer = dynamic(
    () => import("../AgentVersionHistory").then((m) => m.AgentVersionHistoryDrawer),
    {ssr: false},
)

/**
 * The mounted chips of each workflow, oldest first. One history drawer opens per workflow: the
 * newest chip draws it (on a phone the Configuration screen's chip covers the session header's,
 * which stays mounted), so one tap never opens two drawers.
 */
const historyChipsAtomFamily = atomFamily((_workflowId: string) => atom<string[]>([]))

/** Wraps in a tooltip only when there is something to say beyond the visible label. */
const StatusWrap = ({tip, children}: {tip: string | null; children: React.ReactElement}) =>
    tip ? <SimpleTooltip title={tip}>{children}</SimpleTooltip> : <>{children}</>

export interface AgentRevisionStatusProps {
    /** The revision whose version and dirty state this reads. */
    revisionId: string
    /**
     * Turn the `vN` chip into the version-history drawer for this workflow. Omit where the
     * surface has no workflow handle (the chip then just states the version).
     */
    historyWorkflowId?: string | null
    /**
     * Switch this view to the agent's latest version. With it (and `historyWorkflowId`), a newer
     * version shows as an "Update to vN" pill.
     */
    onUpdate?: (revisionId: string) => void
    /** Apply a newer version with no click. Unsaved work holds it back, and the pill then stays. */
    autoUpdate?: boolean
    /** Re-check for a newer version when this changes: pass the session id, so a switch checks. */
    checkKey?: string | null
    /**
     * Lay out for a phone: the chip says "Saved as vN" and has a 44 px hit area, the version
     * history covers the screen with a back arrow, and a save state that needs attention ("Not
     * saved") shows its words, not only its icon.
     */
    phone?: boolean
    /** On a phone, the name of the screen the history's back arrow returns to. */
    backTitle?: string
    /** Only what needs the person: "Update to vN" and a failed save's retry; nothing at rest. */
    quiet?: boolean
    className?: string
}

/**
 * A revision's committed identity: the `vN` chip (its commit message on hover) and a save-status
 * dot. With `historyWorkflowId` the chip opens the version-history drawer instead.
 *
 * The dot reports auto-commit; there is no Save button, so a failed save makes the dot the retry.
 *
 * Rendered by every surface that shows an agent's header — the desktop playground's revision
 * selector and the mobile session workspace's top bar — so the two can never disagree about
 * what "saved" looks like.
 */
export const AgentRevisionStatus = ({
    revisionId,
    historyWorkflowId,
    onUpdate,
    autoUpdate = false,
    checkKey,
    phone = false,
    backTitle,
    quiet = false,
    className,
}: AgentRevisionStatusProps) => {
    const t = useT(headerCatalog, revisionStatusCatalog)
    // A commit can land while this surface is closed — the agent commits itself mid-session, or
    // the same agent is driven from another surface (the desktop playground and `/m` share one
    // agent). The invalidation that follows a commit refetches ACTIVE observers only, and a closed
    // surface has none, so on return the revision queries were still inside their staleTime and
    // this chip named the superseded version (#6380). Revalidate once on mount, where the
    // observers ARE active. It lives here, in the shared chip, because every host that shows a
    // revision has the problem — putting it in one app's wrapper fixed only that app.
    useEffect(() => {
        revalidateAgentRevisionReads(historyWorkflowId)
    }, [historyWorkflowId])

    const data = useAtomValue(workflowMolecule.selectors.data(revisionId || ""))
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId || ""))
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(revisionId || ""))
    const autoCommitStatus = useAtomValue(agentAutoCommitStatusAtomFamily(revisionId || ""))
    const autoCommitError = useAtomValue(agentAutoCommitErrorAtomFamily(revisionId || ""))
    const autoCommitScheduled = useAtomValue(agentAutoCommitScheduledAtomFamily(revisionId || ""))
    const retrySave = useSetAtom(flushAgentAutoCommitAtom)

    const chipId = useId()
    const historyChips = useAtomValue(historyChipsAtomFamily(historyWorkflowId || ""))
    const setHistoryChips = useSetAtom(historyChipsAtomFamily(historyWorkflowId || ""))
    useEffect(() => {
        if (!historyWorkflowId) return
        setHistoryChips((chips) => [...chips, chipId])
        return () => setHistoryChips((chips) => chips.filter((id) => id !== chipId))
    }, [historyWorkflowId, chipId, setHistoryChips])
    const drawsHistory = historyChips[historyChips.length - 1] === chipId
    const historyOpen = useAtomValue(versionHistoryOpenAtomFamily(historyWorkflowId || ""))
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    // Latched, not unmounted on close: tearing the drawer out mid-close skips its slide-out.
    const [historyMounted, setHistoryMounted] = useState(false)
    const [historyOpens, setHistoryOpens] = useState(0)
    useEffect(() => {
        if (!historyOpen) return
        setHistoryMounted(true)
        setHistoryOpens((n) => n + 1)
    }, [historyOpen])

    // The only moments a newer version is looked for: the page becoming visible, the window
    // getting focus, a save of this agent (auto-save here, or a builder's committed result), a
    // session switch (`checkKey`), and the drawer opening.
    const projectId = useAtomValue(projectIdAtom)
    const [latest, setLatest] = useState<LatestVersion | null>(null)
    const offersUpdate = Boolean(onUpdate)
    useEffect(() => {
        if (!offersUpdate || !historyWorkflowId || !projectId) return
        return watchLatestVersion({workflowId: historyWorkflowId, projectId, onLatest: setLatest})
        // `checkKey` and `historyOpens` are triggers: each change is one more check.
    }, [offersUpdate, historyWorkflowId, projectId, checkKey, historyOpens])

    const version = (data?.version as number | null | undefined) ?? null
    const commitMessage = data?.message?.trim() || null
    const newer =
        onUpdate &&
        latest &&
        latest.workflowId === historyWorkflowId &&
        version !== null &&
        latest.version > Number(version)
            ? latest
            : null

    const failed = autoCommitStatus === "error"
    // "Saving…" must mean a save is armed or in flight. Off `isDirty` it also caught every
    // revision auto-commit skips, which sat on "Saving…" forever; those read Draft.
    const saving = isAgent && !failed && (autoCommitScheduled || autoCommitStatus === "saving")
    const settled = !failed && !saving && !isDirty

    const autoUpdateId = autoUpdate && settled ? (newer?.id ?? null) : null
    useEffect(() => {
        if (autoUpdateId) onUpdate?.(autoUpdateId)
    }, [autoUpdateId, onUpdate])

    // "Saved" shows for a moment after a save lands, then only the dot says it.
    const [justSaved, setJustSaved] = useState(false)
    const wasSaving = useRef(false)
    const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => {
        const landed = wasSaving.current && settled
        wasSaving.current = saving
        if (!landed) return
        setJustSaved(true)
        clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_FLASH_MS)
    }, [saving, settled])
    useEffect(() => () => clearTimeout(savedTimer.current), [])
    const showLabel = !settled || justSaved

    const dot = failed
        ? {
              tone: "bg-destructive",
              label: t("playground.agentHeader.notSaved"),
              tip: t("playground.agentHeader.tipFailed", {
                  error: autoCommitError ?? t("playground.agentHeader.couldNotSave"),
              }),
          }
        : saving
          ? {
                tone: "bg-muted-foreground",
                label: t("playground.agentHeader.saving"),
                tip: t("playground.agentHeader.tipSaving"),
            }
          : isDirty
            ? {
                  tone: "bg-warning",
                  label: t("playground.agentHeader.draft"),
                  tip: t("playground.agentHeader.tipDraft"),
              }
            : {
                  tone: "bg-success",
                  label: t("playground.agentHeader.saved"),
                  tip: t("playground.agentHeader.saved"),
              }

    // One object for one revision: the version and its save state describe the same thing, and as
    // two chips they competed. A failed save is the exception — there the status IS the retry
    // control, so it stays separate rather than sharing a button that opens history.
    const merged = version !== null && !!historyWorkflowId && !failed
    const atRest = !failed && !saving && !isDirty

    const statusBody = (
        <>
            {failed ? (
                <WarningCircle size={12} className="shrink-0 text-destructive" />
            ) : (
                <span className={`size-1.5 shrink-0 rounded-round ${dot.tone}`} />
            )}
            {/* Words only for states that need attention; hidden on a narrow bar, except on a
                phone, where the icon alone does not say that a save failed. */}
            {showLabel ? (
                <span className={phone ? undefined : "hidden sm:inline"}>{dot.label}</span>
            ) : null}
        </>
    )

    const historyDrawer =
        historyWorkflowId && historyMounted && drawsHistory ? (
            <AgentVersionHistoryDrawer
                workflowId={historyWorkflowId}
                revisionId={revisionId}
                currentVersion={version}
                onUpdate={onUpdate}
                phone={phone}
                backTitle={backTitle}
            />
        ) : null

    // "Update to vN": a newer version saved elsewhere. On touch the pill keeps its size and gets
    // a 44 px hit area.
    const updatePill =
        newer && !autoUpdateId ? (
            <button
                type="button"
                onClick={() => onUpdate?.(newer.id)}
                className=" shrink-0 cursor-pointer whitespace-nowrap rounded border-0 bg-selected px-1.5 py-0.5 text-label text-primary hover:bg-accent"
            >
                {t("playground.agentHeader.updateAvailable", {version: newer.version})}
            </button>
        ) : null

    const statusControl = (
        <StatusWrap tip={failed ? dot.tip : null}>
            <span
                role={failed ? "button" : undefined}
                tabIndex={failed ? 0 : undefined}
                aria-label={failed ? t("playground.agentHeader.retrySaving") : undefined}
                onClick={failed ? () => void retrySave({revisionId}) : undefined}
                onKeyDown={
                    failed
                        ? (event) => {
                              if (event.key !== "Enter" && event.key !== " ") return
                              event.preventDefault()
                              void retrySave({revisionId})
                          }
                        : undefined
                }
                className={cn(
                    "flex items-center gap-1.5 text-meta text-muted-foreground",
                    failed && "cursor-pointer",
                    failed && "",
                )}
            >
                {statusBody}
            </span>
        </StatusWrap>
    )

    if (quiet) {
        if (!updatePill && !failed && !historyDrawer) return null
        return (
            <div className={`flex items-center gap-2 ${className ?? ""}`}>
                {updatePill}
                {failed ? statusControl : null}
                {historyDrawer}
            </div>
        )
    }

    return (
        <div className={`flex items-center gap-2 ${className ?? ""}`}>
            {merged ? (
                <SimpleTooltip
                    title={t("playground.agentHeader.statusAndHistory", {status: dot.label})}
                >
                    {/* A kit control, the height of the bar's other controls (SIZE-01). */}
                    <Button
                        variant="ghost"
                        size="compact"
                        aria-label={t("playground.agentHeader.versionStatusOpen", {
                            version,
                            status: dot.label,
                        })}
                        onClick={() => openHistory(historyWorkflowId)}
                        className={cn(
                            "gap-1.5",
                            phone
                                ? "whitespace-nowrap"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {/* One chip: the save state is a fact about this version. */}
                        <span className="flex items-center gap-1.5">
                            {/* A caret would promise a menu; this opens a drawer of history. */}
                            {phone ? (
                                // Canvas M07: a 14 px glyph and no dot; the words carry the state
                                // ("Saved as vN", "Saving…").
                                <ClockCounterClockwise size={14} className="size-3.5 shrink-0" />
                            ) : (
                                <span className="relative flex shrink-0">
                                    <ClockCounterClockwise size={12} className="size-3" />
                                    {/* A saved version is the resting state: no mark (LOUD-04). */}
                                    {atRest ? null : (
                                        <span
                                            className={`absolute -right-[2px] -top-[2px] size-1.5 rounded-round ring-1 ring-muted ${dot.tone}`}
                                        />
                                    )}
                                </span>
                            )}
                            {phone
                                ? settled
                                    ? t("playground.revisionStatus.savedAs", {version})
                                    : dot.label
                                : `v${version}`}
                        </span>
                        {showLabel && !phone ? (
                            <span className="hidden sm:inline">{dot.label}</span>
                        ) : null}
                    </Button>
                </SimpleTooltip>
            ) : null}

            {!merged && version !== null ? (
                historyWorkflowId ? (
                    <SimpleTooltip title={t("playground.agentHeader.versionHistory")}>
                        <button
                            type="button"
                            aria-label={t("playground.agentHeader.openVersionHistory")}
                            onClick={() => openHistory(historyWorkflowId)}
                            className="flex cursor-pointer items-center gap-1 rounded border-0 bg-secondary px-1.5 py-0.5 text-meta text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <ClockCounterClockwise size={11} className="shrink-0" />v{version}
                        </button>
                    </SimpleTooltip>
                ) : (
                    <SimpleTooltip
                        className="max-w-[360px]"
                        title={
                            commitMessage ? (
                                <div className="flex flex-col gap-1">
                                    <span className="text-meta font-medium opacity-65">
                                        {t("playground.agentHeader.commitMessage")}
                                    </span>
                                    <div className="max-h-60 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-label font-normal leading-relaxed">
                                        {commitMessage}
                                    </div>
                                </div>
                            ) : (
                                <span className="text-label font-normal italic">
                                    {t("playground.agentHeader.noCommitMessage")}
                                </span>
                            )
                        }
                    >
                        <span className="cursor-default rounded bg-secondary px-1.5 py-0.5 text-meta text-muted-foreground">
                            v{version}
                        </span>
                    </SimpleTooltip>
                )
            ) : null}

            {updatePill}

            {historyDrawer}

            {/* Tooltip only on failure: there it carries the error and the retry hint. */}
            {merged ? null : statusControl}
        </div>
    )
}
