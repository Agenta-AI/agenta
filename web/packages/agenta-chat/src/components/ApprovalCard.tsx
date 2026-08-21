/**
 * The shared approval card — the ONE design for a human-in-the-loop gate, extracted from the
 * desktop ApprovalDock so mobile renders the identical surface instead of a wireframe copy.
 *
 * The card owns what a gate IS: the shield header with the batch count, the one-sentence ask
 * naming what the agent is about to do, and the exact-payload expander.
 * Everything surface-specific — action buttons, steer panels, always-allow rows, trace links,
 * registry-rendered bodies — arrives as slots, so each app keeps its own affordances on the
 * same chrome.
 */
import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {HeightCollapse} from "@agenta/ui/height-collapse"
import {
    AutosizeTextarea,
    Button,
    LoadingButton,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Switch,
} from "@agenta/ui/ui"
import {CaretDown, CaretRight, ShieldCheck} from "@phosphor-icons/react"

import {useAlwaysAllowTool} from "../hooks/useAlwaysAllowTool"
import type {PendingApproval} from "../model/approvals"
import {inSentence, resolveToolDisplay} from "../skin/registry"

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

/** One-line, whitespace-collapsed payload preview — so a batch peek can be an informed click
 * without expanding every gate. Truncated; the full payload stays in the card. */
export const inputPreview = (input: unknown): string => {
    const s = formatInput(input).replace(/\s+/g, " ").trim()
    return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

/** Collapsible exact-payload viewer — the generic approval body, and the fallback (plus the
 * Build-mode raw view) for specialized renderers. Owns its expand state so a specialized body
 * can render it anywhere; hosts key it by approval id to recollapse when the gate changes. */
export const PayloadBlock = ({
    input,
    label = "Payload",
    surfaceClassName = "bg-colorFillQuaternary",
}: {
    input: unknown
    label?: string
    /** The inset well behind the expander (desktop passes its `ag-surface-inset`). */
    surfaceClassName?: string
}) => {
    const [showPayload, setShowPayload] = useState(false)
    const payload = useMemo(() => formatInput(input), [input])
    const payloadPreview = payload.replace(/\s+/g, " ").trim()
    if (!payload) return null
    return (
        <div className={`overflow-hidden rounded ${surfaceClassName}`}>
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

export interface ApprovalCardFrameProps {
    /** The gate being acted on. */
    toolName: string
    input: unknown
    /** Total pending gates in the paused turn (renders "1 of N" beyond 1). */
    count: number
    /** Chat mode: the payload well reads "Details" rather than "Payload". The ask itself is the
     * same humanized sentence either way — a debugger reads the raw name off the title attribute
     * and the expander. */
    friendly?: boolean
    /** Replace the default ask sentence; null = a specialized body owns it (renders nothing). */
    headline?: ReactNode | null
    /** Replace the generic PayloadBlock body (a registry-rendered preview). */
    body?: ReactNode
    /** The action row (and anything below it) — each surface brings its own. */
    children?: ReactNode
    /** Card surface + density (desktop passes its `ag-surface-chat` and a roomier scale for
     * registry bodies; the default is a bordered token card at the standard density). */
    className?: string
    /** The payload well's surface, forwarded to {@link PayloadBlock}. */
    payloadSurfaceClassName?: string
    /** Label over the payload expander ("Details" in chat mode, "Payload" in build). */
    payloadLabel?: string
}

export interface ApprovalCardProps {
    /** Pending gates for the paused turn — index 0 is acted on; the rest feed the batch peek. */
    approvals: PendingApproval[]
    /** A fired decision is settling (disables the controls, drives the spinners). */
    responding?: boolean
    /** Which action fired, for spinner placement on Approve vs Approve all. */
    respondingSource?: "one" | "all" | "deny-all" | null
    /** The agent revision — enables the always-allow row (a draft-config grant). */
    entityId?: string
    /** Show the Redirect (deny + note) entry point — hosts gate it by their own flag. */
    steerEnabled?: boolean
    /** Touch mode: desktop-identical chrome with an invisibly extended ~44px tap area per action. */
    touch?: boolean
    /** A host-side failure to surface under the actions (e.g. the detached resume failed). */
    errorText?: string | null
    /** Replace the Approve label (a registry body's verb, e.g. "Commit"). */
    approveLabel?: string
    /** Left slot of the action row (desktop Build's "View full trace" link). */
    actionExtra?: ReactNode
    /** Answer ONE gate; `message` carries a steer note WITH a denial. */
    onRespond: (args: {approvalId: string; approved: boolean; message?: string}) => void
    /** Approve the whole batch in one step. */
    onApproveAll: (approvalIds: string[]) => void
    /** The peek's turn-level reject — omit to hide "Deny all" (a host without batch deny). */
    onDenyAll?: (approvalIds: string[]) => void
    /** Approve the current tool's OTHER pending gates along with it after an always-allow grant
     * ("don't ask again" shouldn't step through 2/3, 3/3). Omit → only the current gate answers. */
    onApproveCovered?: (approvalIds: string[]) => void
    /** Frame passthrough — see {@link ApprovalCardFrameProps}. */
    friendly?: boolean
    headline?: ReactNode | null
    body?: ReactNode
    className?: string
    payloadSurfaceClassName?: string
    payloadLabel?: string
    /** The batch-peek popover's card + item surfaces (desktop passes its ag-surface-*). */
    peekSurfaceClassName?: string
    peekItemSurfaceClassName?: string
}

/**
 * THE approval card — one component for the whole decision surface, rendered identically by the
 * desktop dock and mobile. It owns the frame, the decision row (Approve / Deny / the Approve-all
 * split button with the informed batch peek / Redirect), the steer panel, and the always-allow
 * row with its arm-then-apply-on-approve semantics. Hosts adapt only transport: how a response
 * actually fires (engine stream vs detached resume) arrives as callbacks, and host chrome
 * (registry bodies, trace links, surfaces) as slots.
 */
export const ApprovalCard = ({
    approvals,
    responding = false,
    respondingSource = null,
    entityId,
    steerEnabled = false,
    touch = false,
    errorText,
    approveLabel,
    actionExtra,
    onRespond,
    onApproveAll,
    onDenyAll,
    onApproveCovered,
    friendly = true,
    headline,
    body,
    className,
    payloadSurfaceClassName,
    payloadLabel,
    peekSurfaceClassName = "border border-solid border-colorBorderSecondary bg-colorBgContainer",
    peekItemSurfaceClassName = "bg-colorFillQuaternary",
}: ApprovalCardProps) => {
    const current = approvals[0]
    const count = approvals.length
    // Armed "always allow this tool" intent for the current gate — applied only when the user
    // clicks Approve, never on its own (the switch must not progress the flow).
    const [alwaysAllowArmed, setAlwaysAllowArmed] = useState(false)
    // Steer: the "Redirect" panel holds an optional instruction sent WITH the denial.
    const [steerOpen, setSteerOpen] = useState(false)
    const [steerMessage, setSteerMessage] = useState("")
    // The field stays mounted inside the collapse, so `autoFocus` only fires at the card's initial
    // mount — focus it explicitly each time the redirect opens. rAF waits for the expand to start
    // so focus lands on a laid-out (not height-0) element.
    const steerInputRef = useRef<HTMLTextAreaElement>(null)
    useEffect(() => {
        if (!steerOpen) return
        const raf = requestAnimationFrame(() => steerInputRef.current?.focus())
        return () => cancelAnimationFrame(raf)
    }, [steerOpen])
    // The current gate changed (we answered one, the next slid in) — disarm and close the panel.
    const currentId = current?.approvalId
    useEffect(() => {
        setAlwaysAllowArmed(false)
        setSteerOpen(false)
        setSteerMessage("")
    }, [currentId])

    const {infoFor, grant} = useAlwaysAllowTool(entityId)

    if (!current) return null

    // The grant covers every call of the tool, so its label must not carry THIS call's arguments:
    // with them it reads "Always allow searching Github open bugs", which understates the scope.
    const grantLabel = resolveToolDisplay(current.toolName).activity.running
    const grantInfo = infoFor(current.toolName)
    const canAlwaysAllow = Boolean(grantInfo.eligible && !grantInfo.alreadyAllowed)
    // Touch mode must NOT change the chrome — the card renders desktop-identical everywhere.
    // Instead the tap target extends invisibly to ~44px via an inset pseudo-element.
    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""

    const approve = () => {
        if (responding) return
        // Apply the armed grant only on approve — never on deny, and never from the switch alone.
        if (alwaysAllowArmed && canAlwaysAllow) {
            grant(current.toolName)
            // "Always allow <tool>" also clears this tool's OTHER pending gates in the batch: the
            // user said they don't want to be prompted for it again, so its siblings auto-approve
            // in one step. Other tools stay gated and are shown next.
            const covered = approvals.filter((a) => a.toolName === current.toolName)
            if (covered.length > 1 && onApproveCovered) {
                onApproveCovered(covered.map((a) => a.approvalId))
                return
            }
        }
        onRespond({approvalId: current.approvalId, approved: true})
    }
    const approveAll = () => {
        if (responding) return
        if (alwaysAllowArmed && canAlwaysAllow) grant(current.toolName)
        onApproveAll(approvals.map((a) => a.approvalId))
    }

    return (
        <ApprovalCardFrame
            toolName={current.toolName}
            input={current.input}
            count={count}
            friendly={friendly}
            headline={headline}
            className={className}
            payloadSurfaceClassName={payloadSurfaceClassName}
            payloadLabel={payloadLabel}
            // Keyed by approval id so the expander recollapses when the gate changes.
            body={
                body ?? (
                    <PayloadBlock
                        key={current.approvalId}
                        input={current.input}
                        label={payloadLabel ?? (friendly ? "Details" : "Payload")}
                        surfaceClassName={payloadSurfaceClassName}
                    />
                )
            }
        >
            {/* Actions: host extra on the left, decision on the right; Approve is the single
                primary. The whole row collapses while steering: an explicit deny+redirect
                shouldn't leave Approve competing, so the redirect panel below becomes the entire
                action surface. Mirrors the panel's expand (open={!steerOpen} vs open={steerOpen})
                for one smooth swap. */}
            <HeightCollapse open={!steerOpen} fade inert>
                <div className="flex items-center gap-2">
                    {actionExtra}
                    <div className="ml-auto flex items-center gap-1.5">
                        {count > 1 ? (
                            // Split button: the primary click approves the whole batch; the caret
                            // opens a peek listing every pending action (so "Approve all" is
                            // informed, not blind) and the explicit turn-level "Deny all".
                            <span className="inline-flex">
                                <LoadingButton
                                    variant="outline"
                                    disabled={responding}
                                    loading={responding && respondingSource === "all"}
                                    onClick={approveAll}
                                    className={`rounded-r-none ${touchCls}`}
                                >
                                    Approve all
                                </LoadingButton>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            disabled={responding}
                                            aria-label="Batch actions"
                                            className={`-ml-px rounded-l-none ${touchCls}`}
                                        >
                                            <CaretDown size={12} />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                        align="end"
                                        className={`box-border flex max-w-[320px] flex-col gap-1.5 rounded-lg p-2 shadow-md ${peekSurfaceClassName}`}
                                    >
                                        <span className="px-1 text-xs text-colorTextSecondary">
                                            Approving all runs these {count} actions:
                                        </span>
                                        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
                                            {approvals.map((a) => {
                                                const preview = inputPreview(a.input)
                                                const label =
                                                    resolveToolDisplay(a.toolName, a.input).activity
                                                        .running || a.toolName
                                                return (
                                                    <div
                                                        key={a.approvalId}
                                                        className={`box-border rounded px-2 py-1.5 ${peekItemSurfaceClassName}`}
                                                    >
                                                        <span
                                                            className="block truncate text-xs font-medium text-colorText"
                                                            title={a.toolName}
                                                        >
                                                            {label}
                                                        </span>
                                                        {preview ? (
                                                            <span className="block truncate font-mono text-xs text-colorTextSecondary">
                                                                {preview}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                        {onDenyAll ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={responding}
                                                onClick={() =>
                                                    onDenyAll(approvals.map((a) => a.approvalId))
                                                }
                                                className="justify-start text-colorError hover:bg-colorErrorBg"
                                            >
                                                Deny all
                                            </Button>
                                        ) : null}
                                    </PopoverContent>
                                </Popover>
                            </span>
                        ) : null}
                        {steerEnabled ? (
                            <Button
                                variant="ghost"
                                disabled={responding}
                                className={`text-colorTextSecondary ${touchCls}`}
                                onClick={() => setSteerOpen(true)}
                            >
                                Redirect
                            </Button>
                        ) : null}
                        <Button
                            variant="outline"
                            disabled={responding}
                            className={touchCls}
                            onClick={() =>
                                onRespond({approvalId: current.approvalId, approved: false})
                            }
                        >
                            Deny
                        </Button>
                        <LoadingButton
                            disabled={responding}
                            loading={responding && respondingSource === "one"}
                            onClick={approve}
                            className={touchCls}
                        >
                            {approveLabel ?? "Approve"}
                        </LoadingButton>
                    </div>
                </div>
            </HeightCollapse>

            {/* Steer: an inline redirect note, revealed on demand by the Redirect button above.
                Kept inside the card so it collapses with it and can't linger over another
                session. Complements the action row (open={steerOpen} vs open={!steerOpen}) so
                one expands exactly as the other collapses. Unmounted (not merely collapsed)
                while the flag is off: a collapsed HeightCollapse still leaves its controls in
                the DOM and tab order. */}
            {steerEnabled ? (
                <HeightCollapse open={steerOpen} fade inert>
                    <div className="flex flex-col gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-2.5">
                        <span className="text-xs text-colorTextSecondary">
                            Deny this step and tell the agent what to do instead — your note runs as
                            the next message.
                        </span>
                        {/* Filled + borderless-at-rest so the redirect reads as a nested field of
                            the approval card, subordinate to the main composer below. The filled
                            variant lights its border with the full primary on focus, so we pin
                            hover/focus to a neutral border and drop the focus glow. */}
                        <AutosizeTextarea
                            ref={steerInputRef}
                            variant="filled"
                            autoSize={{minRows: 2, maxRows: 6}}
                            value={steerMessage}
                            onChange={(e) => setSteerMessage(e.target.value)}
                            placeholder="e.g. write to staging, not prod — or ask for something else entirely"
                            disabled={responding}
                            className="text-xs hover:border-colorBorder focus:border-colorBorder focus:shadow-none"
                        />
                        <div className="flex items-center justify-end gap-1.5">
                            <Button
                                variant="ghost"
                                disabled={responding}
                                className={touchCls}
                                onClick={() => setSteerOpen(false)}
                            >
                                Cancel
                            </Button>
                            {/* Default, not primary: Approve is the card's single primary. This is
                                the confirm for the redirect sub-action, so it stays quiet. */}
                            <Button
                                variant="outline"
                                disabled={responding || !steerMessage.trim()}
                                className={touchCls}
                                onClick={() =>
                                    onRespond({
                                        approvalId: current.approvalId,
                                        approved: false,
                                        message: steerMessage,
                                    })
                                }
                            >
                                Deny &amp; send
                            </Button>
                        </div>
                    </div>
                </HeightCollapse>
            ) : null}

            {/* Always-allow: arms a config write-through so this tool stops asking. The switch
                only ARMS the intent; the grant is applied when the user clicks Approve. Shown
                only for gateway / custom-function / builtin gates that aren't already allowed.
                Collapses while steering — "applies when you approve" contradicts a deny+redirect
                — as the mirror of the steer panel's expand, for one smooth swap. */}
            {canAlwaysAllow ? (
                <HeightCollapse open={!steerOpen} fade inert>
                    <div className="flex items-center gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-2.5">
                        <Switch
                            checked={alwaysAllowArmed}
                            disabled={responding}
                            onCheckedChange={setAlwaysAllowArmed}
                        />
                        <div className="flex min-w-0 flex-col">
                            <span className="text-xs text-colorText">
                                Always allow{" "}
                                <span className="font-medium">
                                    {inSentence(grantLabel) || current.toolName}
                                </span>{" "}
                                for this agent
                            </span>
                            <span className="text-xs text-colorTextSecondary">
                                Applies when you approve.
                            </span>
                        </div>
                    </div>
                </HeightCollapse>
            ) : null}

            {errorText ? <p className="m-0 text-xs text-colorError">{errorText}</p> : null}
        </ApprovalCardFrame>
    )
}

/**
 * The card chrome shared by every approval surface: header, identity, headline, body. Actions
 * arrive as children so the desktop's split-button/steer/always-allow and mobile's touch
 * targets sit on identical framing.
 */
export const ApprovalCardFrame = ({
    toolName,
    input,
    count,
    friendly = true,
    headline,
    body,
    children,
    className = "gap-2.5 border border-solid border-colorBorderSecondary bg-colorBgContainer p-3",
    payloadSurfaceClassName,
    payloadLabel,
}: ApprovalCardFrameProps) => {
    // The input goes in too, so the card says the same sentence as the row it gates.
    const display = resolveToolDisplay(toolName, input)
    return (
        <div className={`flex flex-col rounded-lg ${className}`}>
            {/* Header: a quiet primary cue (not an error tint) + the ask + a count when batched. */}
            <div className="flex items-center gap-2">
                <ShieldCheck size={15} weight="fill" className="shrink-0 text-colorPrimary" />
                <span className="text-xs font-medium text-colorText">
                    Approval needed to continue
                </span>
                {count > 1 ? (
                    <span className="ml-auto text-xs tabular-nums text-colorTextSecondary">
                        1 of {count}
                    </span>
                ) : null}
            </div>

            {/* ONE humanized sentence in both modes — the raw name lives in the title attribute
                and the payload expander. A registry body that brings its own headline replaces it;
                one that passes null owns the ask entirely and this renders nothing. */}
            {headline !== null ? (
                <span className="text-xs text-colorTextSecondary" title={toolName}>
                    {headline ?? (
                        <>
                            The agent needs your approval before{" "}
                            <span className="font-medium text-colorText">
                                {inSentence(display.activity.running)}
                            </span>
                            {display.source ? ` from ${display.source}` : ""}.
                        </>
                    )}
                </span>
            ) : null}

            {body ?? (
                <PayloadBlock
                    input={input}
                    label={payloadLabel ?? (friendly ? "Details" : "Payload")}
                    surfaceClassName={payloadSurfaceClassName}
                />
            )}

            {children}
        </div>
    )
}
