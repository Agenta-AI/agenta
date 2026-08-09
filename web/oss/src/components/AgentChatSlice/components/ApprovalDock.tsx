import {memo, useEffect, useMemo, useRef, useState} from "react"

import {ApprovalCard, PayloadBlock} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"
import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {HeightCollapse} from "@agenta/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {isAgentChatSteerEnabled} from "../assets/constants"
import {canonicalToolName} from "../assets/toolDisplay"

import ApprovedContentManifest, {
    parseApprovedContentManifest,
} from "./approvals/ApprovedContentManifest"
import {resolveApprovalRenderer} from "./approvals/registry"

interface ApprovalDockProps {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    onApprovalResponse: (args: {id: string; approved: boolean; message?: string}) => void
    /** Open the paused turn's trace drawer (full tool input/output). */
    onViewTrace?: () => void
    /** Selected agent revision — enables per-tool friendly bodies (approvals/registry). */
    entityId?: string
    className?: string
}

/**
 * Persistent human-in-the-loop approval band. Lives in the composer region (between the transcript
 * and the input), NOT in the scrolling transcript, so a run paused on a tool gate can't scroll out
 * of reach. The card itself — frame, decision row, batch peek, steer panel, always-allow — is the
 * shared `ApprovalCard` (mobile renders the same one); this dock is the desktop adapter: it owns
 * the open/close animation, the multi-gate resolve latch, and how a response actually fires.
 *
 * A turn can request several gates at once; we act on the first and let the SDK flip its state,
 * which re-renders us onto the next — so `responding` resets whenever the current id changes.
 */
const ApprovalDock = ({
    approvals,
    onApprovalResponse,
    onViewTrace,
    entityId,
    className,
}: ApprovalDockProps) => {
    const open = approvals.length > 0
    // A resolve can answer SEVERAL gates at once — "Approve all", or "Approve" with the always-allow
    // toggle on (which also clears that tool's other pending gates, since the user asked not to be
    // prompted for it again). Each response settles asynchronously (the SDK's serial job queue), so
    // the pending set shrinks across renders; without a latch the dock would step through the batch
    // ("1 of 3 → 1 of 2"). `resolvingIds` holds the gates we fired responses for; while any is still
    // pending the card stays frozen on the latched set (then closes if nothing remains, or steps —
    // if only some gates were covered, then steps to the uncovered remainder).
    const [resolvingIds, setResolvingIds] = useState<readonly string[] | null>(null)
    const [resolveSource, setResolveSource] = useState<"all" | "deny-all" | "one" | null>(null)
    const resolving =
        resolvingIds !== null && approvals.some((a) => resolvingIds.includes(a.approvalId))
    // Latch the last non-empty set so the card stays visible while the dock animates closed (a leave
    // transition needs its content through the height collapse) AND so a multi-gate resolve doesn't
    // step through the batch.
    const shownRef = useRef(approvals)
    if (open && !resolving) shownRef.current = approvals
    const shown = shownRef.current
    const current = shown[0]

    const [responding, setResponding] = useState(false)
    // Feature flag: the "Redirect" (steer) control is OFF by default. The UI is complete, but the
    // redirect runs as a follow-up turn — the model reasons about the bare denial before it lands —
    // so we hide the entry point until the runner-level reject-and-redirect lands. Only the control
    // is gated; the rest of the implementation ships intact behind it. See [[isAgentChatSteerEnabled]].
    const steerEnabled = isAgentChatSteerEnabled()

    // The current gate changed (we answered one, the next slid in) — re-enable. Held during a
    // resolve (current is frozen), so it fires only on a real step or a new batch. The card resets
    // its own armed/steer state on the same signal.
    useEffect(() => {
        setResponding(false)
        setResolveSource(null)
    }, [current?.approvalId])

    // Once every gate we fired has settled (left the pending set), drop the latch — the dock then
    // closes if nothing remains, or re-latches onto the uncovered gates (a mixed-tool batch).
    useEffect(() => {
        if (resolvingIds !== null && !approvals.some((a) => resolvingIds.includes(a.approvalId))) {
            setResolvingIds(null)
        }
    }, [approvals, resolvingIds])

    // Registry bodies render in BOTH modes (Build gets the compact one-column shape) and need a
    // revision to diff against; the entityId-less host keeps the exact-payload card.
    const chatMode = useAtomValue(chatPanelMaximizedAtom)
    const renderer =
        current && entityId ? resolveApprovalRenderer(canonicalToolName(current.toolName)) : null
    // The manifest is a SIBLING of the payload, never inside it, so the generic card has to render
    // it itself: the frozen content is what the approval binds, in every mode. Skipped when a
    // specialized body is active, because that body renders the manifest already.
    const fallbackManifest = useMemo(
        () => (renderer ? null : parseApprovedContentManifest(current?.manifest)),
        [renderer, current?.manifest],
    )

    // How a resolve fires here: straight through the stream transport, one response per gate.
    const respondMany = (ids: string[], approved: boolean, source: "all" | "deny-all" | "one") => {
        if (responding) return
        setResponding(true)
        setResolveSource(source)
        // Freeze the card so the dock doesn't step through the batch as each response settles — it
        // holds "1 of N" and closes once all are answered (see `resolvingIds`).
        setResolvingIds(ids)
        ids.forEach((id) => onApprovalResponse({id, approved}))
    }

    // Always mounted; enter + leave animate via the shared HeightCollapse (CSS height + fade,
    // reduced-motion-proof) — the same primitive the queue, connect banner, and config sections use.
    // `inert` while closed drops the (clipped, latched) card from tab order + a11y so a keyboard user
    // can't reach hidden buttons.
    return (
        <HeightCollapse open={open} className={className} durationMs={240} fade inert>
            <div className="min-h-0">
                {current ? (
                    <ApprovalCard
                        approvals={shown}
                        responding={responding}
                        respondingSource={resolveSource}
                        entityId={entityId}
                        steerEnabled={steerEnabled}
                        // Chat folds the humanized name into one sentence; Build keeps the raw
                        // name + source chip. A friendly body (headline: null) already says
                        // what's happening — nothing extra.
                        friendly={chatMode}
                        headline={renderer ? renderer.headline : undefined}
                        // The friendly two-pane body needs more air than the one-line payload card.
                        className={`ag-surface-chat mb-2 ${renderer ? "gap-4 p-4" : "gap-2.5 p-3"}`}
                        payloadSurfaceClassName="ag-surface-inset"
                        peekSurfaceClassName="ag-surface-chat border border-solid border-colorBorderSecondary"
                        peekItemSurfaceClassName="ag-surface-inset"
                        approveLabel={renderer?.approveLabel}
                        // Body: friendly per-tool preview when registered, else the card's default
                        // exact-payload block.
                        body={
                            renderer && entityId ? (
                                <renderer.Body
                                    key={current.approvalId}
                                    input={current.input}
                                    entityId={entityId}
                                    manifest={current.manifest}
                                    compact={!chatMode}
                                    fallback={
                                        <PayloadBlock
                                            input={current.input}
                                            surfaceClassName="ag-surface-inset"
                                        />
                                    }
                                />
                            ) : fallbackManifest ? (
                                <div className="flex min-w-0 flex-col gap-2.5">
                                    <PayloadBlock
                                        key={current.approvalId}
                                        input={current.input}
                                        surfaceClassName="ag-surface-inset"
                                        label={chatMode ? "Details" : "Payload"}
                                    />
                                    <ApprovedContentManifest manifest={fallbackManifest} />
                                </div>
                            ) : undefined
                        }
                        // Trace link is Build-only chrome — Chat keeps the payload expander.
                        actionExtra={
                            onViewTrace && !chatMode ? (
                                <button
                                    type="button"
                                    onClick={onViewTrace}
                                    className="flex cursor-pointer items-center gap-1 border-0 bg-transparent px-0 py-0.5 text-xs text-colorPrimary transition-colors hover:underline"
                                >
                                    <ArrowSquareOut size={12} />
                                    View full trace
                                </button>
                            ) : undefined
                        }
                        onRespond={({approvalId, approved, message}) => {
                            if (responding) return
                            setResponding(true)
                            setResolveSource("one")
                            onApprovalResponse({
                                id: approvalId,
                                approved,
                                ...(message?.trim() ? {message: message.trim()} : {}),
                            })
                        }}
                        onApproveAll={(ids) => respondMany(ids, true, "all")}
                        // The explicit turn-level reject — the deny counterpart to "Approve all",
                        // never inferred from a per-card Deny. No always-allow grant on a deny.
                        onDenyAll={(ids) => respondMany(ids, false, "deny-all")}
                        onApproveCovered={(ids) => respondMany(ids, true, "one")}
                    />
                ) : null}
            </div>
        </HeightCollapse>
    )
}

export default memo(ApprovalDock)
