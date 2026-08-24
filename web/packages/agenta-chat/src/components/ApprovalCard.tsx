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
import {useEffect, useMemo, useRef, useState} from "react"

import {HeightCollapse} from "@agenta/ui/height-collapse"
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
    // Armed "don't ask again" intent — applied only when the user approves, never on its own.
    const [alwaysAllowArmed, setAlwaysAllowArmed] = useState(false)
    // Which button fired, so the spinner lands on it (the hosts only report "busy").
    const [firedAction, setFiredAction] = useState<"approve" | "deny" | null>(null)
    const [steerOpen, setSteerOpen] = useState(false)
    const [steerMessage, setSteerMessage] = useState("")
    // The field stays mounted inside the collapse, so focus it explicitly each time it opens; the
    // rAF waits for the expand to start so focus lands on a laid-out element.
    const steerInputRef = useRef<HTMLTextAreaElement>(null)
    useEffect(() => {
        if (!steerOpen) return
        const raf = requestAnimationFrame(() => steerInputRef.current?.focus())
        return () => cancelAnimationFrame(raf)
    }, [steerOpen])

    // The current gate changed (we answered one, the next slid in) — reset every local intent.
    const currentId = current?.approvalId
    useEffect(() => {
        setDetailsOpen(false)
        setAlwaysAllowArmed(false)
        setFiredAction(null)
        setSteerOpen(false)
        setSteerMessage("")
    }, [currentId])
    useEffect(() => {
        if (!responding) setFiredAction(null)
    }, [responding])

    const {infoFor, grant} = useAlwaysAllowTool(entityId)

    // A commit gate parses its whole delta + manifest, so memoize on the gate id (a gate's payload
    // is immutable) rather than re-parsing on every keystroke and `responding` toggle.
    const preview = useMemo(
        () => (current ? describeApproval(current) : null),
        [current?.approvalId],
    )
    // A batch answers as a whole, so the rows list the pending ACTIONS rather than one gate's
    // changes — this is what replaced the peek popover.
    const items = useMemo(
        () => (batched ? describeBatchItems(approvals) : (preview?.items ?? [])),
        [batched, approvals, preview],
    )

    if (!current || !preview) return null

    const grantInfo = infoFor(current.toolName)
    const canAlwaysAllow = Boolean(grantInfo.eligible && !grantInfo.alreadyAllowed)
    // Touch must NOT change the chrome — the tap target extends invisibly instead.
    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""

    const approve = () => {
        if (responding) return
        setFiredAction("approve")
        if (alwaysAllowArmed && canAlwaysAllow) grant(current.toolName)
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
        <div className={`flex flex-col rounded-lg ${className}`}>
            {/* Eyebrow: a quiet cue that a decision is owed, not an error tint. */}
            <div className="flex items-center gap-1.5">
                <ShieldCheck size={14} weight="fill" className="shrink-0 text-colorTextTertiary" />
                <span className="text-xs font-medium text-colorTextTertiary">
                    Needs your approval
                </span>
            </div>

            {/* The whole ask, in one sentence — what happens, and what it costs. */}
            <span
                className="text-[13px] leading-relaxed text-colorTextSecondary [text-wrap:pretty]"
                title={current.toolName}
            >
                {preview.sentence}
            </span>

            {items.length ? (
                <>
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
                            {items.map((item, index) => (
                                <div
                                    key={`${item.title}-${index}`}
                                    className="flex min-w-0 flex-col gap-0.5 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2 last:border-b-0"
                                >
                                    <span className="text-xs font-medium text-colorText">
                                        {item.title}
                                    </span>
                                    {item.detail ? (
                                        <span className="truncate text-xs leading-relaxed text-colorTextSecondary">
                                            {item.detail}
                                        </span>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </HeightCollapse>
                </>
            ) : null}

            {/* Actions. The whole row collapses while steering: an explicit deny+redirect shouldn't
                leave Approve competing, so the redirect panel becomes the entire action surface. */}
            <HeightCollapse open={!steerOpen} fade inert>
                <div className="flex items-center gap-2 pt-0.5">
                    {canAlwaysAllow ? (
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-colorTextSecondary">
                            <Checkbox
                                checked={alwaysAllowArmed}
                                disabled={responding}
                                onCheckedChange={(checked) => setAlwaysAllowArmed(checked === true)}
                            />
                            Don&apos;t ask again for this
                        </label>
                    ) : null}
                    <div className="ml-auto flex items-center gap-1.5">
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
                            variant="outline"
                            disabled={responding}
                            loading={responding && firedAction === "deny"}
                            className={touchCls}
                            onClick={deny}
                        >
                            {batched && onDenyAll ? "Deny all" : "Deny"}
                        </LoadingButton>
                        <LoadingButton
                            disabled={responding}
                            loading={responding && firedAction === "approve"}
                            className={touchCls}
                            onClick={approve}
                        >
                            {batched ? "Approve all" : "Approve"}
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
