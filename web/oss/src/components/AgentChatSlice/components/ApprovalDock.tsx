import {memo, useEffect, useMemo, useRef, useState} from "react"

import {HeightCollapse} from "@agenta/ui"
import {ArrowSquareOut, CaretDown, CaretRight, ShieldCheck} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Button, Dropdown, Switch, Typography} from "antd"
import {useAtomValue} from "jotai"

import {useAlwaysAllowTool} from "@/oss/hooks/useAlwaysAllowTool"

import {partToolName, resolveToolDisplay} from "../assets/toolDisplay"
import {chatPanelMaximizedAtom} from "../state/panelLayout"

import {resolveApprovalRenderer} from "./approvals/registry"

const {Text} = Typography

export interface PendingApproval {
    approvalId: string
    toolName: string
    input: unknown
}

interface ApprovalRef {
    id: string
}

const isToolPart = (type: string) => type.startsWith("tool-") || type === "dynamic-tool"

/**
 * Approvals the run is currently blocked on. HITL only ever pauses the LAST assistant turn (see
 * `isHitlPending`), so we read pending tool gates off that turn — a turn can request several at
 * once (parallel tool calls), so this returns all of them in order.
 */
export const getPendingApprovals = (messages: UIMessage[]): PendingApproval[] => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return []
    const out: PendingApproval[] = []
    for (const part of last.parts ?? []) {
        const p = part as ToolUIPart
        const approval = (p as {approval?: ApprovalRef}).approval
        if (isToolPart(p.type as string) && p.state === "approval-requested" && approval?.id) {
            out.push({approvalId: approval.id, toolName: partToolName(p), input: p.input})
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
                <span className="shrink-0 text-[11px] font-medium text-colorTextSecondary">
                    {label}
                </span>
                {!showPayload ? (
                    <span className="min-w-0 truncate font-mono text-[11px] text-colorTextTertiary">
                        {payloadPreview}
                    </span>
                ) : null}
            </button>
            <HeightCollapse open={showPayload}>
                <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all px-2.5 pb-2.5 font-mono text-[11px] leading-snug text-colorTextSecondary">
                    {payload}
                </pre>
            </HeightCollapse>
        </div>
    )
}

interface ApprovalDockProps {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
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

    // The current gate changed (we answered one, the next slid in) — re-enable and disarm. Held
    // during a resolve (current is frozen), so it fires only on a real step or a new batch.
    useEffect(() => {
        setResponding(false)
        setResolveSource(null)
        setAlwaysAllowArmed(false)
    }, [current?.approvalId])

    // Once every gate we fired has settled (left the pending set), drop the latch — the dock then
    // closes if nothing remains, or re-latches onto the uncovered gates (a mixed-tool batch).
    useEffect(() => {
        if (resolvingIds !== null && !approvals.some((a) => resolvingIds.includes(a.approvalId))) {
            setResolvingIds(null)
        }
    }, [approvals, resolvingIds])

    // Friendly bodies are Chat-mode (maximized) sugar and need a revision to diff against;
    // Build and the entityId-less host keep the exact-payload card.
    const chatMode = useAtomValue(chatPanelMaximizedAtom)
    const renderer =
        current && entityId && chatMode ? resolveApprovalRenderer(current.toolName) : null

    // Chat-mode display name: raw "scary" names stay Build-only; the shared resolver humanizes
    // gateway/MCP/plain names. Raw name stays reachable via the tooltip and the payload expander.
    const friendly = current ? resolveToolDisplay(current.toolName) : null
    // A source badge we can state factually from the tool name — not a guessed risk level.
    const source = friendly?.kind === "mcp" ? "MCP tool" : null

    // "Always allow this tool": writes a config permission so the runner stops gating this tool
    // (per-tool `permission` for gateway/custom-function tools; `harness.permissions.allow` for
    // harness builtins like bash). Platform ops (commit_revision, schedules) and MCP are not
    // eligible, so they always stay gated. The write happens on APPROVE (see `respond`), never when
    // the switch is toggled — the switch only arms the intent. buildAgentRequest re-reads the draft
    // on resume, so the grant takes effect for the current run and every future one.
    const {infoFor, grant} = useAlwaysAllowTool(entityId)
    const grantInfo = current ? infoFor(current.toolName) : null
    const canAlwaysAllow = Boolean(grantInfo?.eligible && !grantInfo.alreadyAllowed)

    const respond = (approved: boolean) => {
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
        onApprovalResponse({id: current.approvalId, approved})
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
                                <Text
                                    type="secondary"
                                    className="!text-[11px] ml-auto tabular-nums"
                                >
                                    1 of {count}
                                </Text>
                            ) : null}
                        </div>

                        {/* Identity + ask. Build keeps the raw tool name (debuggers steer by it);
                            Chat folds a humanized name into one sentence — the raw name stays
                            reachable via the tooltip and the payload expander. A friendly body
                            (headline: null) already says what's happening — nothing extra. */}
                        {!renderer && !chatMode ? (
                            <div className="flex min-w-0 items-center gap-2">
                                <Text
                                    className="!text-xs !font-medium min-w-0 truncate"
                                    title={current.toolName}
                                >
                                    {current.toolName}
                                </Text>
                                {source ? (
                                    <span className="shrink-0 rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary px-1.5 py-px text-[11px] text-colorTextSecondary">
                                        {source}
                                    </span>
                                ) : null}
                            </div>
                        ) : null}

                        {renderer?.headline !== null ? (
                            !renderer && chatMode ? (
                                <Text
                                    type="secondary"
                                    className="!text-xs"
                                    title={current.toolName}
                                >
                                    The agent wants to use{" "}
                                    <span className="font-medium text-colorText">
                                        {friendly?.label}
                                    </span>
                                    {friendly?.source ? ` from ${friendly.source}` : ""} before it
                                    can keep going.
                                </Text>
                            ) : (
                                <Text type="secondary" className="!text-xs">
                                    {renderer?.headline ??
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
                                fallback={<PayloadBlock input={current.input} />}
                            />
                        ) : (
                            <PayloadBlock
                                key={current.approvalId}
                                input={current.input}
                                label={chatMode ? "Details" : "Payload"}
                            />
                        )}

                        {/* Actions: trace on the left, decision on the right. Approve is the single primary.
                            The trace link is Build-only chrome — Chat keeps the payload expander instead. */}
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
                                                {key: "deny-all", danger: true, label: "Deny all"},
                                            ],
                                            onClick: denyAll,
                                        }}
                                        popupRender={(menu) => (
                                            <div className="ag-surface-chat box-border flex max-w-[320px] flex-col gap-1.5 rounded-lg border border-solid border-colorBorderSecondary p-2 shadow-md">
                                                <Text
                                                    type="secondary"
                                                    className="!text-[11px] px-1"
                                                >
                                                    Approving all runs these {count} actions:
                                                </Text>
                                                <div className="flex max-h-56 flex-col gap-1 overflow-auto">
                                                    {shown.map((a) => {
                                                        const preview = inputPreview(a.input)
                                                        const label =
                                                            resolveToolDisplay(a.toolName)?.label ??
                                                            a.toolName
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
                                                                        className="!text-[11px] block truncate font-mono"
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

                        {/* Always-allow: arms a config write-through so this tool stops asking. The
                            switch only ARMS the intent (it must not progress the flow); the grant is
                            applied when the user clicks Approve. Shown only for gateway /
                            custom-function / builtin gates that aren't already allowed. */}
                        {canAlwaysAllow ? (
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
                                            {friendly?.label ?? current.toolName}
                                        </span>{" "}
                                        for this agent
                                    </Text>
                                    <Text type="secondary" className="!text-[11px]">
                                        Applies when you approve; commit to use it in triggers.
                                    </Text>
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </HeightCollapse>
    )
}

export default memo(ApprovalDock)
