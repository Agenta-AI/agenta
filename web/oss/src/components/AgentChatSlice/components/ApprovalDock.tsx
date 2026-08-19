import {memo, useEffect, useMemo, useRef, useState} from "react"

import {HeightCollapse} from "@agenta/ui"
import {ArrowSquareOut, CaretDown, CaretRight, ChatText, ShieldCheck} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {type GetRef, Button, Dropdown, Input, Switch, Typography} from "antd"
import {useAtomValue} from "jotai"

import {useAlwaysAllowTool} from "@/oss/hooks/useAlwaysAllowTool"

import {isAgentChatSteerEnabled} from "../assets/constants"
import {isToolPart} from "../assets/messageParts"
import {
    canonicalToolName,
    inSentence,
    partToolName,
    resolveToolDisplay,
} from "../assets/toolDisplay"
import {chatPanelMaximizedAtom} from "../state/panelLayout"

import ApprovedContentManifest, {
    parseApprovedContentManifest,
} from "./approvals/ApprovedContentManifest"
import {resolveApprovalRenderer} from "./approvals/registry"

const {Text} = Typography

export interface PendingApproval {
    approvalId: string
    toolName: string
    input: unknown
    /** Workspace content the runner resolved and froze for this gate, when the call imports any. */
    manifest?: unknown
}

interface ApprovalRef {
    id: string
}

/** Manifests keyed by toolCallId, from the egress's `data-approval-manifest` sibling parts. */
const manifestsByToolCallId = (parts: UIMessage["parts"] = []): Map<string, unknown> => {
    const found = new Map<string, unknown>()
    for (const part of parts) {
        if ((part as {type?: string}).type !== "data-approval-manifest") continue
        const data = (part as {data?: Record<string, unknown>}).data
        const toolCallId = data?.toolCallId
        if (typeof toolCallId === "string" && data?.manifest !== undefined) {
            found.set(toolCallId, data.manifest)
        }
    }
    return found
}

/** Pending approval gates across assistant messages, in transcript order. */
export const getPendingApprovals = (messages: UIMessage[]): PendingApproval[] => {
    const out: PendingApproval[] = []
    for (const message of messages) {
        if (message.role !== "assistant") continue
        const manifests = manifestsByToolCallId(message.parts)
        for (const part of message.parts ?? []) {
            const p = part as ToolUIPart
            const approval = (p as {approval?: ApprovalRef}).approval
            if (isToolPart(part) && p.state === "approval-requested" && approval?.id) {
                out.push({
                    approvalId: approval.id,
                    toolName: partToolName(p),
                    input: p.input,
                    manifest: manifests.get(p.toolCallId),
                })
            }
        }
    }
    return out
}

const formatInput = (input: unknown): string => {
    if (input == null) return ""
    // Keep the exact string — the user must approve the payload the tool actually receives. The
    // one-line preview normalizes whitespace; this expanded view must not alter it.
    if (typeof input === "string") return input
    try {
        return JSON.stringify(input, null, 2)
    } catch {
        return String(input)
    }
}

/** One-line, whitespace-collapsed payload preview for the batch peek — so "Approve all" can be
 * an informed click without expanding every gate. Truncated; the full payload stays in the card. */
const inputPreview = (input: unknown): string => {
    const s = formatInput(input).replace(/\s+/g, " ").trim()
    return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

/** Collapsible exact-payload viewer — the generic approval body, and the fallback (plus the
 * Build-mode raw view) for specialized renderers. Owns its expand state so a specialized body
 * can render it anywhere; hosts key it by approval id to recollapse when the gate changes. */
const PayloadBlock = ({input, label = "Payload"}: {input: unknown; label?: string}) => {
    const [showPayload, setShowPayload] = useState(false)
    const payload = useMemo(() => formatInput(input), [input])
    const payloadPreview = payload.replace(/\s+/g, " ").trim()
    if (!payload) return null
    return (
        <div className="ag-surface-inset overflow-hidden rounded">
            <button
                type="button"
                onClick={() => setShowPayload((s) => !s)}
                aria-expanded={showPayload}
                className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 py-1.5 text-left"
            >
                <CaretRight
                    size={11}
                    weight="bold"
                    className={`shrink-0 text-colorTextTertiary transition-transform ${
                        showPayload ? "rotate-90" : ""
                    }`}
                />
                <span className="shrink-0 text-xs font-medium text-colorTextSecondary">
                    {label}
                </span>
                {!showPayload ? (
                    <span className="min-w-0 truncate font-mono text-xs text-colorTextTertiary">
                        {payloadPreview}
                    </span>
                ) : null}
            </button>
            <HeightCollapse open={showPayload}>
                <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all px-2.5 pb-2.5 font-mono text-xs leading-snug text-colorTextSecondary">
                    {payload}
                </pre>
            </HeightCollapse>
        </div>
    )
}

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
 * of reach. It owns the Approve/Deny action (the inline tool row is just an "Awaiting approval"
 * marker) and surfaces the request's context: which tool, its source, and the exact payload.
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
    // pending we FREEZE the shown set so the card holds steady and the dock closes in one step (or,
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
    const count = shown.length

    const [responding, setResponding] = useState(false)
    // Armed "always allow this tool" intent for the current gate — applied only when the user
    // clicks Approve, never on its own (the switch must not progress the flow).
    const [alwaysAllowArmed, setAlwaysAllowArmed] = useState(false)
    // Steer: the "Redirect" panel holds an optional instruction sent WITH the denial.
    const [steerOpen, setSteerOpen] = useState(false)
    const [steerMessage, setSteerMessage] = useState("")
    // The field stays mounted inside the collapse, so `autoFocus` only fires at the dock's initial
    // mount (while hidden) — focus it explicitly each time the redirect opens. rAF waits for the
    // expand to start so focus lands on a laid-out (not height-0) element.
    const steerInputRef = useRef<GetRef<typeof Input.TextArea>>(null)
    useEffect(() => {
        if (!steerOpen) return
        const raf = requestAnimationFrame(() => steerInputRef.current?.focus())
        return () => cancelAnimationFrame(raf)
    }, [steerOpen])
    // Feature flag: the "Redirect" (steer) control is OFF by default. The UI is complete, but the
    // redirect runs as a follow-up turn — the model reasons about the bare denial before it lands —
    // so we hide the entry point until the runner-level reject-and-redirect lands. Only the control
    // is gated; the rest of the implementation ships intact behind it. See [[isAgentChatSteerEnabled]].
    const steerEnabled = isAgentChatSteerEnabled()

    // The current gate changed (we answered one, the next slid in) — re-enable and disarm. Held
    // during a resolve (current is frozen), so it fires only on a real step or a new batch.
    useEffect(() => {
        setResponding(false)
        setResolveSource(null)
        setAlwaysAllowArmed(false)
        setSteerOpen(false)
        setSteerMessage("")
    }, [current?.approvalId])

    // Belt-and-braces: also close + clear the redirect note whenever nothing is pending, so the
    // draft never carries into the next gate and the section can't outlive the card.
    useEffect(() => {
        if (approvals.length === 0) {
            setSteerOpen(false)
            setSteerMessage("")
        }
    }, [approvals.length])

    // Once every gate we fired has settled (left the pending set), drop the latch — the dock then
    // closes if nothing remains, or re-latches onto the uncovered gates (a mixed-tool batch).
    useEffect(() => {
        if (resolvingIds !== null && !approvals.some((a) => resolvingIds.includes(a.approvalId))) {
            setResolvingIds(null)
        }
    }, [approvals, resolvingIds])

    // Friendly bodies run in BOTH modes: a raw payload is not a readable change, and Build is the
    // default mode. They still need a revision to diff against, so the entityId-less host keeps
    // the exact-payload card. Build gets the compact one-column shape (`compact` below).
    const chatMode = useAtomValue(chatPanelMaximizedAtom)
    // Canonical name: Claude wraps our tools as `mcp__agenta-tools__<tool>`, and keying the
    // registry on the raw name dropped every Claude commit back to the exact-payload card.
    const renderer =
        current && entityId ? resolveApprovalRenderer(canonicalToolName(current.toolName)) : null
    // The manifest is a SIBLING of the payload, never inside it, so the generic card has to render
    // it itself: the frozen content is what the approval binds, in every mode. Skipped when a
    // specialized body is active, because that body renders the manifest already.
    const fallbackManifest = useMemo(
        () => (renderer ? null : parseApprovedContentManifest(current?.manifest)),
        [renderer, current?.manifest],
    )

    // Chat-mode display name: raw "scary" names stay Build-only; the shared resolver humanizes
    // gateway/MCP/plain names. Raw name stays reachable via the tooltip and the payload expander.
    // The input goes in too, so this card says the same sentence as the row it gates.
    const friendly = current ? resolveToolDisplay(current.toolName, current.input) : null
    // The grant covers every call of the tool, so its label must not carry THIS call's arguments:
    // with them it reads "Always allow searching Github open bugs", which understates the scope.
    const grantLabel = current ? resolveToolDisplay(current.toolName).activity.running : ""

    // "Always allow this tool": writes a config permission so the runner stops gating this tool
    // (per-tool `permission` for gateway/custom-function tools; `harness.permissions.allow` for
    // harness builtins like bash). Platform ops (commit_revision, schedules) and MCP are not
    // eligible, so they always stay gated. The write happens on APPROVE (see `respond`), never when
    // the switch is toggled — the switch only arms the intent. buildAgentRequest re-reads the draft
    // on resume, so the grant takes effect for the current run and every future one.
    const {infoFor, grant} = useAlwaysAllowTool(entityId)
    const grantInfo = current ? infoFor(current.toolName) : null
    const canAlwaysAllow = Boolean(grantInfo?.eligible && !grantInfo.alreadyAllowed)

    const respond = (approved: boolean, message?: string) => {
        if (responding || !current) return
        setResponding(true)
        setResolveSource("one")
        // Apply the armed grant only on approve — never on deny, and never from the switch alone.
        if (approved && alwaysAllowArmed && canAlwaysAllow) {
            grant(current.toolName)
            // "Always allow <tool>" also clears this tool's OTHER pending gates in the batch: the
            // user said they don't want to be prompted for it again, so its siblings auto-approve
            // in one step instead of making them click through 2/3, 3/3. Other tools stay gated and
            // are shown next.
            const covered = shown.filter((a) => a.toolName === current.toolName)
            if (covered.length > 1) {
                setResolvingIds(covered.map((a) => a.approvalId))
                covered.forEach((a) => onApprovalResponse({id: a.approvalId, approved: true}))
                return
            }
        }
        onApprovalResponse({
            id: current.approvalId,
            approved,
            ...(message?.trim() ? {message: message.trim()} : {}),
        })
    }
    const approveAll = () => {
        if (responding) return
        setResponding(true)
        setResolveSource("all")
        if (alwaysAllowArmed && canAlwaysAllow && current) grant(current.toolName)
        // Freeze the card so the dock doesn't step through the batch as each response settles — it
        // holds "1 of N" and closes once all are answered (see `resolvingIds`).
        setResolvingIds(shown.map((a) => a.approvalId))
        shown.forEach((a) => onApprovalResponse({id: a.approvalId, approved: true}))
    }
    // The explicit turn-level reject — the deny counterpart to "Approve all", never inferred from a
    // per-card Deny. Answers every open gate as a warm reject via resume (no teardown); the card
    // freezes and the dock closes in one step. No always-allow grant is ever applied on a deny.
    const denyAll = () => {
        if (responding) return
        setResponding(true)
        setResolveSource("deny-all")
        setResolvingIds(shown.map((a) => a.approvalId))
        shown.forEach((a) => onApprovalResponse({id: a.approvalId, approved: false}))
    }

    // Always mounted; enter + leave animate via the shared HeightCollapse (CSS height + fade,
    // reduced-motion-proof) — the same primitive the queue, connect banner, and config sections use.
    // `inert` while closed drops the (clipped, latched) card from tab order + a11y so a keyboard user
    // can't reach hidden buttons.
    return (
        <HeightCollapse open={open} className={className} durationMs={240} fade inert>
            <div className="min-h-0">
                {current ? (
                    // The friendly two-pane body needs more air than the one-line payload card.
                    <div
                        className={`ag-surface-chat mb-2 flex flex-col rounded-lg ${
                            renderer ? "gap-4 p-4" : "gap-2.5 p-3"
                        }`}
                    >
                        {/* Header: a quiet primary cue (not an error tint) + the ask + a count when batched. */}
                        <div className="flex items-center gap-2">
                            <ShieldCheck
                                size={15}
                                weight="fill"
                                className="shrink-0 text-colorPrimary"
                            />
                            <Text className="!text-xs !font-medium">
                                Approval needed to continue
                            </Text>
                            {count > 1 ? (
                                <Text type="secondary" className="!text-xs ml-auto tabular-nums">
                                    1 of {count}
                                </Text>
                            ) : null}
                        </div>

                        {/* One humanized sentence in both modes; the raw name lives in the tooltip. */}
                        {renderer?.headline !== null ? (
                            !renderer ? (
                                <Text
                                    type="secondary"
                                    className="!text-xs"
                                    title={current.toolName}
                                >
                                    The agent needs your approval before{" "}
                                    <span className="font-medium text-colorText">
                                        {inSentence(friendly?.activity.running ?? "")}
                                    </span>
                                    {friendly?.source ? ` from ${friendly.source}` : ""}.
                                </Text>
                            ) : (
                                <Text type="secondary" className="!text-xs">
                                    {renderer.headline ??
                                        "The agent wants to run this tool before it can keep going."}
                                </Text>
                            )
                        ) : null}

                        {/* Body: friendly per-tool preview when registered, else the exact payload.
                            Keyed by approval id so expand state recollapses when the gate changes. */}
                        {renderer && entityId ? (
                            <renderer.Body
                                key={current.approvalId}
                                input={current.input}
                                entityId={entityId}
                                manifest={current.manifest}
                                compact={!chatMode}
                                fallback={<PayloadBlock input={current.input} />}
                            />
                        ) : (
                            <div className="flex min-w-0 flex-col gap-2.5">
                                <PayloadBlock
                                    key={current.approvalId}
                                    input={current.input}
                                    label={chatMode ? "Details" : "Payload"}
                                />
                                {fallbackManifest ? (
                                    <ApprovedContentManifest manifest={fallbackManifest} />
                                ) : null}
                            </div>
                        )}

                        {/* Actions: trace on the left, decision on the right; Approve is the single
                            primary (trace link is Build-only chrome — Chat keeps the payload expander).
                            The whole row collapses while steering: an explicit deny+redirect shouldn't
                            leave the yellow Approve competing, so the redirect panel below becomes the
                            entire action surface. Mirrors the panel's expand (open={!steerOpen} vs
                            open={steerOpen}) for one smooth swap. */}
                        <HeightCollapse open={!steerOpen} fade inert>
                            <div className="flex items-center gap-2">
                                {onViewTrace && !chatMode ? (
                                    <button
                                        type="button"
                                        onClick={onViewTrace}
                                        className="flex cursor-pointer items-center gap-1 border-0 bg-transparent px-0 py-0.5 text-xs text-colorPrimary transition-colors hover:underline"
                                    >
                                        <ArrowSquareOut size={12} />
                                        View full trace
                                    </button>
                                ) : null}
                                <div className="ml-auto flex items-center gap-1.5">
                                    {count > 1 ? (
                                        // Split button: the primary click approves the whole batch; the
                                        // caret opens a peek listing every pending action (so "Approve
                                        // all" is informed, not blind) and the explicit turn-level
                                        // "Deny all". Per-card Deny/Approve below stay for stepping one
                                        // at a time.
                                        <Dropdown.Button
                                            disabled={responding}
                                            loading={responding && resolveSource === "all"}
                                            icon={<CaretDown size={12} />}
                                            onClick={approveAll}
                                            menu={{
                                                items: [
                                                    {
                                                        key: "deny-all",
                                                        danger: true,
                                                        label: "Deny all",
                                                    },
                                                ],
                                                onClick: denyAll,
                                            }}
                                            popupRender={(menu) => (
                                                <div className="ag-surface-chat box-border flex max-w-[320px] flex-col gap-1.5 rounded-lg border border-solid border-colorBorderSecondary p-2 shadow-md">
                                                    <Text
                                                        type="secondary"
                                                        className="!text-xs px-1"
                                                    >
                                                        Approving all runs these {count} actions:
                                                    </Text>
                                                    <div className="flex max-h-56 flex-col gap-1 overflow-auto">
                                                        {shown.map((a) => {
                                                            const preview = inputPreview(a.input)
                                                            const label =
                                                                resolveToolDisplay(
                                                                    a.toolName,
                                                                    a.input,
                                                                ).activity.running || a.toolName
                                                            return (
                                                                <div
                                                                    key={a.approvalId}
                                                                    className="ag-surface-inset box-border rounded px-2 py-1.5"
                                                                >
                                                                    <Text
                                                                        className="!text-xs !font-medium block truncate"
                                                                        title={a.toolName}
                                                                    >
                                                                        {label}
                                                                    </Text>
                                                                    {preview ? (
                                                                        <Text
                                                                            type="secondary"
                                                                            className="!text-xs block truncate font-mono"
                                                                        >
                                                                            {preview}
                                                                        </Text>
                                                                    ) : null}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                    {menu}
                                                </div>
                                            )}
                                        >
                                            Approve all
                                        </Dropdown.Button>
                                    ) : null}
                                    {steerEnabled ? (
                                        <Button
                                            type="text"
                                            disabled={responding}
                                            icon={<ChatText size={14} />}
                                            className="!text-colorTextSecondary"
                                            onClick={() => setSteerOpen(true)}
                                        >
                                            Redirect
                                        </Button>
                                    ) : null}
                                    <Button disabled={responding} onClick={() => respond(false)}>
                                        Deny
                                    </Button>
                                    <Button
                                        type="primary"
                                        disabled={responding}
                                        loading={responding && resolveSource === "one"}
                                        onClick={() => respond(true)}
                                    >
                                        {renderer?.approveLabel ?? "Approve"}
                                    </Button>
                                </div>
                            </div>
                        </HeightCollapse>

                        {/* Steer: an inline redirect note, revealed on demand by the Redirect
                            button above. Kept inside the card (not a body portal) so it collapses
                            with the dock and can't linger over another session after a tab switch.
                            It and the always-allow row below share this bottom slot and animate as a
                            complementary pair (open={steerOpen} vs open={!steerOpen}, same primitive,
                            same fade) so one expands exactly as the other collapses — no pop-vs-slide. */}
                        {/* Unmounted (not merely collapsed) while the flag is off: a collapsed
                            HeightCollapse still leaves its controls in the DOM and tab order. */}
                        {steerEnabled ? (
                            <HeightCollapse open={steerOpen} fade inert>
                                <div className="flex flex-col gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-2.5">
                                    <Text type="secondary" className="!text-xs">
                                        Deny this step and tell the agent what to do instead — your
                                        note runs as the next message.
                                    </Text>
                                    {/* Filled + borderless-at-rest so the redirect reads as a nested field
                                    of the approval card, subordinate to the main composer below — not a
                                    second, louder input competing with it. The filled variant lights its
                                    border with the full primary on focus (louder than the composer), so
                                    we pin hover/focus to a neutral border and drop the focus glow. */}
                                    <Input.TextArea
                                        ref={steerInputRef}
                                        variant="filled"
                                        autoSize={{minRows: 2, maxRows: 6}}
                                        value={steerMessage}
                                        onChange={(e) => setSteerMessage(e.target.value)}
                                        placeholder="e.g. write to staging, not prod — or ask for something else entirely"
                                        disabled={responding}
                                        className="!text-xs hover:!border-colorBorder focus:!border-colorBorder focus:!shadow-none"
                                    />
                                    <div className="flex items-center justify-end gap-1.5">
                                        <Button
                                            type="text"
                                            disabled={responding}
                                            onClick={() => setSteerOpen(false)}
                                        >
                                            Cancel
                                        </Button>
                                        {/* Default, not primary: Approve is the card's single primary. This
                                        is the confirm for the redirect sub-action, so it stays quiet. */}
                                        <Button
                                            disabled={responding || !steerMessage.trim()}
                                            onClick={() => respond(false, steerMessage)}
                                        >
                                            Deny &amp; send
                                        </Button>
                                    </div>
                                </div>
                            </HeightCollapse>
                        ) : null}

                        {/* Always-allow: arms a config write-through so this tool stops asking. The
                            switch only ARMS the intent (it must not progress the flow); the grant is
                            applied when the user clicks Approve. Shown only for gateway /
                            custom-function / builtin gates that aren't already allowed. Collapses while
                            steering (open={!steerOpen}) — "applies when you approve" contradicts a
                            deny+redirect — as the mirror of the steer panel's expand, for one smooth swap. */}
                        {canAlwaysAllow ? (
                            <HeightCollapse open={!steerOpen} fade inert>
                                <div className="flex items-center gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-2.5">
                                    <Switch
                                        checked={alwaysAllowArmed}
                                        disabled={responding}
                                        onChange={setAlwaysAllowArmed}
                                    />
                                    <div className="flex min-w-0 flex-col">
                                        <Text className="!text-xs">
                                            Always allow{" "}
                                            <span className="font-medium">
                                                {inSentence(grantLabel) || current.toolName}
                                            </span>{" "}
                                            for this agent
                                        </Text>
                                        <Text type="secondary" className="!text-xs">
                                            Applies when you approve; commit to use it in triggers.
                                        </Text>
                                    </div>
                                </div>
                            </HeightCollapse>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </HeightCollapse>
    )
}

export default memo(ApprovalDock)
