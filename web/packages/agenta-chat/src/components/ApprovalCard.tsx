/**
 * The shared approval card — ONE design for a human-in-the-loop gate, rendered identically by the
 * desktop dock and mobile, in every mode.
 *
 * The card deliberately shows no payload, no diff, and no digest. A gate resolves to plain
 * language through `describeApproval`, and everything beyond the one-sentence ask folds behind a
 * single toggle. Hosts adapt transport only: how a response actually fires arrives as callbacks.
 * There is no `body` slot and no mode flag, because a second visual shape is exactly what this
 * card exists to remove.
 */
import {useEffect, useId, useMemo, useRef, useState} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {isOnScreen, isOverlayOpen, shortcutAria} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {AutosizeTextarea, Button, Checkbox, LoadingButton} from "@agenta/ui/ui"
import {CaretRight, ShieldCheck} from "@phosphor-icons/react"

import {useAlwaysAllowTool} from "../hooks/useAlwaysAllowTool"
import {describeApproval, describeBatchItems} from "../model/approvalPreview"
import type {PendingApproval} from "../model/approvals"

export interface ApprovalCardProps {
    /** Pending gates for the paused turn — index 0 is the one a single decision answers. */
    approvals: PendingApproval[]
    /** A fired decision is settling (disables the controls, drives the spinner). */
    responding?: boolean
    /** The agent revision — enables the always-allow row (a draft-config grant). */
    entityId?: string
    /** Show the Redirect (deny + note) entry point — hosts gate it by their own flag. */
    steerEnabled?: boolean
    /** Touch mode: identical chrome with an invisibly extended ~44px tap area per action. */
    touch?: boolean
    /** A host-side failure to surface under the actions (e.g. the detached resume failed). */
    errorText?: string | null
    /** Answer ONE gate; `message` carries a steer note WITH a denial. */
    onRespond: (args: {approvalId: string; approved: boolean; message?: string}) => void
    /** Approve the whole batch in one step — the primary action whenever there is more than one. */
    onApproveAll: (approvalIds: string[]) => void
    /** Deny the whole batch. Omit (mobile has no batch deny) and Deny answers the current gate. */
    onDenyAll?: (approvalIds: string[]) => void
    /** Card surface + density; hosts pass their own token surface. */
    className?: string
}

export const ApprovalCard = ({
    approvals,
    responding = false,
    entityId,
    steerEnabled = false,
    touch = false,
    errorText,
    onRespond,
    onApproveAll,
    onDenyAll,
    className = "gap-2.5 border border-solid border-colorBorderSecondary bg-colorBgContainer p-3.5",
}: ApprovalCardProps) => {
    const current = approvals[0]
    const count = approvals.length
    const batched = count > 1

    const [detailsOpen, setDetailsOpen] = useState(false)
    // Which detail rows are expanded from their one-line preview to the full text.
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
    const toggleRow = (index: number) =>
        setExpandedRows((prev) => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    // Armed auto-approve intent — applied only when the user approves, never on its own.
    const [alwaysAllowArmed, setAlwaysAllowArmed] = useState(false)
    const alwaysAllowId = useId()
    const alwaysAllowLabelId = `${alwaysAllowId}-label`
    // Which button fired, so the spinner lands on it (the hosts only report "busy").
    const [firedAction, setFiredAction] = useState<"approve" | "deny" | null>(null)
    const [steerOpen, setSteerOpen] = useState(false)
    const [steerMessage, setSteerMessage] = useState("")
    // The field stays mounted inside the collapse, so focus it explicitly each time it opens; the
    // rAF waits for the expand to start so focus lands on a laid-out element.
    const steerInputRef = useRef<HTMLTextAreaElement>(null)
    // Every visited session stays mounted behind `display: none`, so a hidden card must not answer.
    const rootRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!steerOpen) return
        const raf = requestAnimationFrame(() => steerInputRef.current?.focus())
        return () => cancelAnimationFrame(raf)
    }, [steerOpen])

    // The current gate changed (we answered one, the next slid in) — reset every local intent.
    const currentId = current?.approvalId
    useEffect(() => {
        setDetailsOpen(false)
        setExpandedRows(new Set())
        setAlwaysAllowArmed(false)
        setFiredAction(null)
        setSteerOpen(false)
        setSteerMessage("")
    }, [currentId])
    useEffect(() => {
        if (!responding) setFiredAction(null)
    }, [responding])

    const {infoFor, grantMany} = useAlwaysAllowTool(entityId)

    // A commit gate parses its whole delta + manifest, so memoize on the gate id (a gate's payload
    // is immutable) rather than re-parsing on every keystroke and `responding` toggle.
    const base = useMemo(() => (current ? describeApproval(current) : null), [current?.approvalId])
    // The catalog answers late, so re-describe once it names the slug (#6349). Disabled on "".
    const sourceKey = base?.sourceKey ?? ""
    const {integration} = useToolIntegrationDetail(sourceKey)
    const appName = sourceKey ? integration?.name : undefined
    const preview = useMemo(
        () => (current && appName ? describeApproval(current, appName) : base),
        [current?.approvalId, appName, base],
    )
    // A batch answers as a whole, so the rows list the pending ACTIONS rather than one gate's
    // changes — this is what replaced the peek popover.
    const items = useMemo(
        () => (batched ? describeBatchItems(approvals) : (preview?.items ?? [])),
        [batched, approvals, preview],
    )

    if (!current || !preview) return null

    // A batch answers as a whole, so the grant covers every tool it would approve, not just the
    // first gate's. Ineligible members (a commit op mixed in) simply stay gated.
    const grantableTools = [
        ...new Set((batched ? approvals : [current]).map((approval) => approval.toolName)),
    ].filter((toolName) => {
        const info = infoFor(toolName)
        return info.eligible && !info.alreadyAllowed
    })
    const canAlwaysAllow = grantableTools.length > 0
    // Touch must NOT change the chrome — the tap target extends invisibly instead.
    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""
    // The keycaps ride on the actions themselves, so the gesture reads without a hover. A touch
    // reader has no keyboard, so they earn no space there.
    const showKeys = !touch

    const approve = () => {
        if (responding) return
        setFiredAction("approve")
        if (alwaysAllowArmed && canAlwaysAllow) grantMany(grantableTools)
        if (batched) return onApproveAll(approvals.map((a) => a.approvalId))
        onRespond({approvalId: current.approvalId, approved: true})
    }
    const deny = () => {
        if (responding) return
        setFiredAction("deny")
        // No always-allow grant on a deny, ever.
        if (batched && onDenyAll) return onDenyAll(approvals.map((a) => a.approvalId))
        onRespond({approvalId: current.approvalId, approved: false})
    }

    // Keyboard shortcuts, live only while a gate is parked and unanswered. Cmd/Ctrl+Enter
    // approves (the modifier is required — it mirrors the composer's send gesture and stops a bare
    // Enter from ever committing) and Escape denies. Both are ignored while the Redirect textarea
    // has focus, so a note-in-progress can use Escape/Enter for its own editing. `approve`/`deny`
    // already no-op while `responding`, so a double-fire is harmless.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            // Something on top owns the keyboard. Both halves are load-bearing: Radix cancels
            // Escape for a dialog, menu or popover but still lets it reach us, and it never
            // touches Cmd+Enter, which only the overlay check catches.
            if (event.defaultPrevented || isOverlayOpen()) return
            // The listener is on `window`, and a parallel run parks a gate in a session you are
            // not looking at. Without this, one Cmd+Enter answered every hidden card too.
            if (rootRef.current && !isOnScreen(rootRef.current)) return
            if (steerOpen) return
            const approveChord = (event.metaKey || event.ctrlKey) && event.key === "Enter"
            const denyChord = event.key === "Escape" && !event.metaKey && !event.ctrlKey
            if (!approveChord && !denyChord) return
            // Escape must not deny while the user is typing (e.g. clearing a queued message in the
            // composer). Cmd/Ctrl+Enter still fires from a field — it mirrors the composer's send.
            const target = event.target as HTMLElement | null
            const typing =
                !!target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
            if (denyChord && typing) return
            event.preventDefault()
            if (approveChord) approve()
            else deny()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    })

    return (
        <div ref={rootRef} className={`flex flex-col rounded-lg ${className}`}>
            {/* Eyebrow: a quiet cue that a decision is owed, not an error tint. */}
            <div className="flex items-center gap-1.5">
                <ShieldCheck size={14} weight="fill" className="shrink-0 text-colorText" />
                <span className="text-xs font-medium text-colorText">Needs your approval</span>
            </div>

            {/* The whole ask, in one sentence — what happens, and what it costs. */}
            <span
                className="text-[13px] leading-relaxed text-colorTextSecondary [text-wrap:pretty]"
                title={current.toolName}
            >
                {preview.sentence}
            </span>

            {items.length ? (
                <div className="flex flex-col gap-2.5">
                    <button
                        type="button"
                        onClick={() => setDetailsOpen((s) => !s)}
                        aria-expanded={detailsOpen}
                        className="flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-xs text-colorTextSecondary transition-colors hover:text-colorText"
                    >
                        <CaretRight
                            size={11}
                            weight="bold"
                            className={`shrink-0 transition-transform ${detailsOpen ? "rotate-90" : ""}`}
                        />
                        {/* The count sits in the label so the size is known before opening. */}
                        {detailsOpen
                            ? "Hide the details"
                            : `${batched ? "See what runs" : "See what changes"} (${items.length})`}
                    </button>
                    <HeightCollapse open={detailsOpen}>
                        <div className="flex max-h-[196px] flex-col overflow-y-auto rounded-md border border-solid border-colorBorderSecondary bg-colorFillQuaternary">
                            {items.map((item, index) => {
                                const rowOpen = expandedRows.has(index)
                                const rowClass =
                                    "flex min-w-0 flex-col gap-0.5 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2 text-left last:border-b-0"
                                const title = (
                                    <span className="text-xs font-medium text-colorText">
                                        {item.title}
                                    </span>
                                )
                                // A row with a detail is one clickable target — the whole row (title,
                                // text, padding) toggles between the one-line preview and full text.
                                if (item.detail) {
                                    return (
                                        <button
                                            key={`${item.title}-${index}`}
                                            type="button"
                                            onClick={() => toggleRow(index)}
                                            aria-expanded={rowOpen}
                                            className={`${rowClass} w-full cursor-pointer bg-transparent`}
                                        >
                                            {title}
                                            <span
                                                className={`w-full text-xs leading-relaxed text-colorTextSecondary ${
                                                    rowOpen
                                                        ? "whitespace-pre-wrap break-words"
                                                        : "truncate"
                                                }`}
                                            >
                                                {item.detail}
                                            </span>
                                        </button>
                                    )
                                }
                                return (
                                    <div key={`${item.title}-${index}`} className={rowClass}>
                                        {title}
                                    </div>
                                )
                            })}
                        </div>
                    </HeightCollapse>
                </div>
            ) : null}

            {/* Actions. The whole row collapses while steering: an explicit deny+redirect shouldn't
                leave Approve competing, so the redirect panel becomes the entire action surface. */}
            <HeightCollapse className="-mt-1" open={!steerOpen} fade inert>
                {/* Wraps rather than squeezes: with Redirect on, the buttons drop to their own line
                    instead of shoving Approve off a narrow screen. */}
                <div className="flex flex-wrap items-center gap-2">
                    {canAlwaysAllow ? (
                        <label className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-colorTextSecondary">
                            <Checkbox
                                checked={alwaysAllowArmed}
                                disabled={responding}
                                onCheckedChange={(checked) => setAlwaysAllowArmed(checked === true)}
                                aria-labelledby={alwaysAllowLabelId}
                                className="shrink-0"
                            />
                            <span id={alwaysAllowLabelId}>Always auto-approve</span>
                        </label>
                    ) : null}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
                        <LoadingButton
                            variant="ghost"
                            disabled={responding}
                            loading={responding && firedAction === "deny"}
                            className={touchCls}
                            onClick={deny}
                            aria-keyshortcuts={shortcutAria("approval.deny")}
                        >
                            {batched && onDenyAll ? "Deny all" : "Deny"}
                            {/* Decorative: the button's own label already names the action. */}
                            {showKeys ? (
                                <ShortcutKeys id="approval.deny" aria-hidden className="ml-1.5" />
                            ) : null}
                        </LoadingButton>
                        <LoadingButton
                            disabled={responding}
                            loading={responding && firedAction === "approve"}
                            className={touchCls}
                            onClick={approve}
                            aria-keyshortcuts={shortcutAria("approval.approve")}
                        >
                            {batched ? "Approve all" : "Approve"}
                            {showKeys ? (
                                <ShortcutKeys
                                    id="approval.approve"
                                    tone="inverse"
                                    aria-hidden
                                    className="ml-1.5"
                                />
                            ) : null}
                        </LoadingButton>
                    </div>
                </div>
            </HeightCollapse>

            {/* Steer: an inline redirect note. Unmounted (not merely collapsed) while the flag is
                off — a collapsed HeightCollapse still leaves its controls in the tab order. */}
            {steerEnabled ? (
                <HeightCollapse open={steerOpen} fade inert>
                    <div className="flex flex-col gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-2.5">
                        <span className="text-xs text-colorTextSecondary">
                            Deny this step and tell the agent what to do instead — your note runs as
                            the next message.
                        </span>
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
                            {/* Default, not primary: Approve is the card's single primary. */}
                            <Button
                                variant="outline"
                                disabled={responding || !steerMessage.trim()}
                                className={touchCls}
                                onClick={() => {
                                    setFiredAction("deny")
                                    onRespond({
                                        approvalId: current.approvalId,
                                        approved: false,
                                        message: steerMessage,
                                    })
                                }}
                            >
                                Deny &amp; send
                            </Button>
                        </div>
                    </div>
                </HeightCollapse>
            ) : null}

            {errorText ? <p className="m-0 text-xs text-colorError">{errorText}</p> : null}
        </div>
    )
}
