import {useEffect, useState} from "react"

import {invalidateAgentCommittedRevisionCache, workflowMolecule} from "@agenta/entities/workflow"
import {
    agentAutoCommitErrorAtomFamily,
    agentAutoCommitScheduledAtomFamily,
    agentAutoCommitStatusAtomFamily,
    flushAgentAutoCommitAtom,
} from "@agenta/playground/state"
import {SimpleTooltip} from "@agenta/ui/ui"
import {ClockCounterClockwise, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {openAgentVersionHistoryAtom, versionHistoryOpenAtomFamily} from "../AgentVersionHistory"

// Mounted only once opened: the drawer pulls the whole revision list and diff machinery.
const AgentVersionHistoryDrawer = dynamic(
    () => import("../AgentVersionHistory").then((m) => m.AgentVersionHistoryDrawer),
    {ssr: false},
)

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
    className,
}: AgentRevisionStatusProps) => {
    // A commit can land while this surface is closed — the agent commits itself mid-session, or
    // the same agent is driven from another surface (the desktop playground and `/m` share one
    // agent). The invalidation that follows a commit refetches ACTIVE observers only, and a closed
    // surface has none, so on return the revision queries were still inside their staleTime and
    // this chip named the superseded version (#6380). Revalidate once on mount, where the
    // observers ARE active. It lives here, in the shared chip, because every host that shows a
    // revision has the problem — putting it in one app's wrapper fixed only that app.
    useEffect(() => {
        invalidateAgentCommittedRevisionCache()
    }, [])

    const data = useAtomValue(workflowMolecule.selectors.data(revisionId || ""))
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId || ""))
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(revisionId || ""))
    const autoCommitStatus = useAtomValue(agentAutoCommitStatusAtomFamily(revisionId || ""))
    const autoCommitError = useAtomValue(agentAutoCommitErrorAtomFamily(revisionId || ""))
    const autoCommitScheduled = useAtomValue(agentAutoCommitScheduledAtomFamily(revisionId || ""))
    const retrySave = useSetAtom(flushAgentAutoCommitAtom)

    const historyOpen = useAtomValue(versionHistoryOpenAtomFamily(historyWorkflowId || ""))
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    // Latched, not unmounted on close: tearing the drawer out mid-close skips its slide-out.
    const [historyMounted, setHistoryMounted] = useState(false)
    useEffect(() => {
        if (historyOpen) setHistoryMounted(true)
    }, [historyOpen])

    const version = (data?.version as number | null | undefined) ?? null
    const commitMessage = data?.message?.trim() || null

    const failed = autoCommitStatus === "error"
    // "Saving…" must mean a save is armed or in flight. Off `isDirty` it also caught every
    // revision auto-commit skips, which sat on "Saving…" forever; those read Draft.
    const saving = isAgent && !failed && (autoCommitScheduled || autoCommitStatus === "saving")

    const dot = failed
        ? {
              tone: "bg-colorError",
              label: "Not saved",
              tip: `${autoCommitError ?? "Couldn't save changes"} — click to retry`,
          }
        : saving
          ? {tone: "bg-colorTextTertiary", label: "Saving…", tip: "Saving your changes"}
          : isDirty
            ? {tone: "bg-colorWarning", label: "Draft", tip: "Unsaved changes"}
            : {tone: "bg-colorSuccess", label: "Saved", tip: "Saved"}

    // One object for one revision: the version and its save state describe the same thing, and as
    // two chips they competed. A failed save is the exception — there the status IS the retry
    // control, so it stays separate rather than sharing a button that opens history.
    const merged = version !== null && !!historyWorkflowId && !failed

    const statusBody = (
        <>
            {failed ? (
                <WarningCircle size={12} className="shrink-0 text-colorError" />
            ) : (
                <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dot.tone}`} />
            )}
            {/* The word is the first thing to go on a narrow bar — the dot and its tooltip
                already say it, and the identity beside it needs the room. */}
            <span className="hidden sm:inline">{dot.label}</span>
        </>
    )

    return (
        <div className={`flex items-center gap-2 ${className ?? ""}`}>
            {merged ? (
                <SimpleTooltip title="Version history">
                    <button
                        type="button"
                        aria-label={`Version ${version}, ${dot.label}. Open version history`}
                        onClick={() => openHistory(historyWorkflowId)}
                        className="flex cursor-pointer items-center gap-1.5 rounded border-0 bg-colorFillSecondary px-1.5 py-0.5 text-xs text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
                    >
                        {/* A caret would promise a menu; this opens a drawer of history. */}
                        <ClockCounterClockwise size={11} className="shrink-0" />v{version}
                        <span className="text-colorTextQuaternary">·</span>
                        {statusBody}
                    </button>
                </SimpleTooltip>
            ) : null}

            {!merged && version !== null ? (
                historyWorkflowId ? (
                    <SimpleTooltip title="Version history">
                        <button
                            type="button"
                            aria-label="Open version history"
                            onClick={() => openHistory(historyWorkflowId)}
                            className="flex cursor-pointer items-center gap-1 rounded border-0 bg-colorFillSecondary px-1.5 py-0.5 text-xs text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText"
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
                                    <span className="text-[12px] font-medium uppercase tracking-wide opacity-65">
                                        Commit message
                                    </span>
                                    <div className="max-h-[240px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-xs leading-relaxed">
                                        {commitMessage}
                                    </div>
                                </div>
                            ) : (
                                <span className="text-xs italic">No commit message</span>
                            )
                        }
                    >
                        <span className="cursor-default rounded bg-colorFillSecondary px-1.5 py-0.5 text-xs text-colorTextSecondary">
                            v{version}
                        </span>
                    </SimpleTooltip>
                )
            ) : null}

            {historyWorkflowId && historyMounted ? (
                <AgentVersionHistoryDrawer workflowId={historyWorkflowId} revisionId={revisionId} />
            ) : null}

            {/* Tooltip only on failure: there it carries the error and the retry hint. */}
            {merged ? null : (
                <StatusWrap tip={failed ? dot.tip : null}>
                    <span
                        role={failed ? "button" : undefined}
                        tabIndex={failed ? 0 : undefined}
                        aria-label={failed ? "Retry saving changes" : undefined}
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
                        className={`flex items-center gap-1.5 text-xs text-colorTextTertiary ${
                            failed ? "cursor-pointer" : ""
                        }`}
                    >
                        {statusBody}
                    </span>
                </StatusWrap>
            )}
        </div>
    )
}
