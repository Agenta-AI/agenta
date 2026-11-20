/**
 * The shared approval card — ONE design for a human-in-the-loop gate, rendered identically by the
 * desktop dock and mobile, in every mode.
 *
 * The card shows no raw payload. A gate resolves to plain language through `describeApproval`,
 * and everything beyond the one-sentence ask folds behind a single toggle. An agent change is the
 * one exception: its changes show in place, with the old and new values of the server preview.
 * Hosts adapt transport only: how a response actually fires arrives as callbacks. There is no
 * `body` slot and no mode flag.
 *
 * Several change calls of one turn share one grouped card (`ChangeCallGroups`). After the answer the
 * card shrinks to the row "Waiting for the agent"; a reader who cannot answer sees the row "Only
 * the owner can approve" in place of the buttons (`ChangeResultRow`).
 */
import {useEffect, useId, useMemo, useRef, useState} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {useDriveHomeSlug} from "@agenta/entity-ui/drive"
import {useT} from "@agenta/i18n"
import chatApprovalCardCatalog from "@agenta/i18n/catalogs/chat.approvalCard"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"
import chatChangeCardStatesCatalog from "@agenta/i18n/catalogs/chat.changeCardStates"
import {isOnScreen, isOverlayOpen, shortcutAria} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import {useIsPhone} from "@agenta/ui/phone"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {AutosizeTextarea, Button, Checkbox, LoadingButton} from "@agenta/ui/ui"
import {CaretRight, ShieldCheck} from "@phosphor-icons/react"

import {useAlwaysAllowTool} from "../hooks/useAlwaysAllowTool"
import {useChangeVersions} from "../hooks/useChangeVersions"
import {useHardwareKeyboard} from "../hooks/useHardwareKeyboard"
import {describeApproval, describeBatchItems} from "../model/approvalPreview"
import type {PendingApproval} from "../model/approvals"
import {changeCallState} from "../model/changeCallState"

import {ChangeCallGroups} from "./ChangeCallGroups"
import {ChangeResultRow} from "./ChangeResultRow"
import {ChangeSections, removesOnly, RiskLine} from "./ChangeSections"

export interface ApprovalCardProps {
    /** Pending gates for the paused turn — index 0 is the one a single decision answers. */
    approvals: PendingApproval[]
    /** A fired decision is settling (disables the controls, drives the spinner). */
    responding?: boolean
    /** The durable response was accepted; the card stays put while records catch up. */
    answered?: boolean
    /** The durable continuation could not be delivered and will retry on the next Send. */
    recoverable?: boolean
    /** The agent revision — enables the always-allow row (a draft-config grant). */
    entityId?: string
    /** Show the Redirect (deny + note) entry point — hosts gate it by their own flag. */
    steerEnabled?: boolean
    /** Touch mode: identical chrome with an invisibly extended ~44px tap area per action. A phone
     *  width draws the actions 44 px high instead, whatever this says. */
    touch?: boolean
    /** A host-side failure to surface under the actions (e.g. the detached resume failed). */
    errorText?: string | null
    /** Answer ONE gate; `message` carries a steer note WITH a denial. */
    onRespond: (args: {approvalId: string; approved: boolean; message?: string}) => void
    /** Approve the whole batch in one step — the primary action whenever there is more than one. */
    onApproveAll: (approvalIds: string[]) => void
    /** Deny the whole batch. Omit (mobile has no batch deny) and Deny answers the current gate. */
    onDenyAll?: (approvalIds: string[]) => void
    /** Card surface + density; hosts pass their own token surface. A change card draws its own
     *  chrome (C01: parts from edge to edge, the footer band), so it does not use this. */
    className?: string
    /** Offer "Always auto-approve". Off in a builder chat: the grant would go to the builder
     *  itself, not to the agent it edits (OPEN-QUESTIONS 2.67). */
    alwaysAllowOffered?: boolean
    /**
     * The viewer cannot answer (they can view the chat but not send to it): the card keeps the
     * eyebrow, the ask and the details, and drops every answer control and shortcut.
     */
    readOnly?: boolean
    /** Shown in place of the actions while `readOnly`; the host words it (it names the owner). */
    readOnlyNote?: string | null
    /**
     * Whether the keys (Cmd/Ctrl+Enter, Escape) belong to this card now. A host with two
     * conversations on screen answers by the focus, so one key answers one card. Omitted, the
     * card on screen takes them.
     */
    ownsShortcut?: (card: HTMLElement) => boolean
}

export const ApprovalCard = ({
    approvals,
    responding = false,
    answered = false,
    recoverable = false,
    entityId,
    steerEnabled = false,
    touch = false,
    errorText,
    onRespond,
    onApproveAll,
    onDenyAll,
    readOnly = false,
    readOnlyNote,
    ownsShortcut,
    alwaysAllowOffered = true,
    className = "gap-2.5 border border-solid border-colorBorderSecondary bg-colorBgContainer p-3.5",
}: ApprovalCardProps) => {
    const current = approvals[0]
    const count = approvals.length
    const batched = count > 1

    const t = useT(chatApprovalCardCatalog)
    const tChange = useT(chatChangeCardCatalog)
    const tStates = useT(chatChangeCardStatesCatalog)
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
    const hasKeyboard = useHardwareKeyboard()

    // A commit gate parses its whole delta + manifest, so memoize on the gate id (a gate's payload
    // is immutable) rather than re-parsing on every keystroke and `responding` toggle.
    const homeSlug = useDriveHomeSlug()
    // The server preview can land after the gate, so its arrival describes the gate again.
    const hasChangePreview = current?.changePreview !== undefined
    const base = useMemo(
        () => (current ? describeApproval(current, undefined, homeSlug) : null),
        [current?.approvalId, hasChangePreview, homeSlug],
    )
    // The catalog answers late, so re-describe once it names the slug (#6349). Disabled on "".
    const sourceKey = base?.sourceKey ?? ""
    const {integration} = useToolIntegrationDetail(sourceKey)
    const appName = sourceKey ? integration?.name : undefined
    const preview = useMemo(
        () => (current && appName ? describeApproval(current, appName, homeSlug) : base),
        [current?.approvalId, appName, homeSlug, base],
    )
    // A batch answers as a whole, so the rows list the pending ACTIONS rather than one gate's
    // changes — this is what replaced the peek popover.
    // One agent change shows its changes in place; the rows behind the toggle would repeat them.
    // A refused change with no rows still shows its notice.
    const changes =
        !batched && (preview?.changes?.length || preview?.cannotApply || preview?.header)
            ? (preview.changes ?? [])
            : null
    // Several change calls: one grouped card with a group per call. A batch with any other tool
    // keeps the list of actions behind the toggle.
    const batchKey = approvals
        .map((approval) => `${approval.approvalId}:${approval.changePreview !== undefined}`)
        .join("|")
    const grouped = useMemo(() => {
        if (!batched) return null
        const previews = approvals.map((approval) =>
            describeApproval(approval, undefined, homeSlug),
        )
        return previews.every((one) => one.changes?.length) ? previews : null
        // Keyed on the ids and the preview arrivals: they are what change a batch's description.
    }, [batched, batchKey, homeSlug])
    const items = useMemo(
        () =>
            grouped
                ? []
                : batched
                  ? describeBatchItems(approvals, homeSlug)
                  : changes
                    ? []
                    : (preview?.items ?? []),
        [grouped, batched, approvals, homeSlug, preview, changes],
    )

    // "Saves as v{base + 1}", and the conflict state when a newer version landed after the base.
    const versions = useChangeVersions(changes ? preview?.base : undefined)
    const {baseVersion, latestVersion} = versions
    const conflict =
        baseVersion !== undefined && latestVersion !== undefined && latestVersion > baseVersion

    const removes = changes ? removesOnly(changes) : false
    const risky = Boolean(
        (grouped ? grouped.flatMap((one) => one.changes ?? []) : changes)?.some(
            (change) => change.risks.length,
        ),
    )

    // A batch answers as a whole, so the grant covers every tool it would approve, not just the
    // first gate's. Ineligible members (a commit op mixed in) simply stay gated.
    const grantableTools = [
        ...new Set(
            (batched ? approvals : current ? [current] : []).map((approval) => approval.toolName),
        ),
    ].filter((toolName) => {
        const info = infoFor(toolName)
        return info.eligible && !info.alreadyAllowed
    })
    const canAlwaysAllow = alwaysAllowOffered && grantableTools.length > 0
    // On a phone the actions are drawn 44 px high (M05). Touch elsewhere keeps the chrome and
    // extends the tap target invisibly.
    const phone = useIsPhone()
    // A change card: the C01 chrome, with its parts from edge to edge and a footer band.
    const changeCard = Boolean(changes || grouped)
    const actionCls = phone
        ? `h-11 rounded-[10px] px-4 text-[15px] ${changeCard ? "min-w-[92px]" : ""}`
        : touch
          ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
          : ""
    // The keycaps ride on the actions themselves, so the gesture reads without a hover. Gated on
    // the keyboard, not on `touch`: that prop sizes the buttons, and /m serves desktop browsers too.
    const showKeys = hasKeyboard
    // A change card's buttons are the canvas's 28 px ones (C01); a phone sets 44 px above.
    const buttonSize = changeCard ? "compact" : undefined

    const approve = () => {
        if (!current || responding || readOnly || answered) return
        setFiredAction("approve")
        if (alwaysAllowArmed && canAlwaysAllow) grantMany(grantableTools)
        if (batched) return onApproveAll(approvals.map((a) => a.approvalId))
        onRespond({approvalId: current.approvalId, approved: true})
    }
    const deny = () => {
        if (!current || responding || readOnly || answered) return
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
        // A read-only or answered card answers nothing, so it binds no keys either.
        if (readOnly || answered) return
        const onKeyDown = (event: KeyboardEvent) => {
            const approveChord = (event.metaKey || event.ctrlKey) && event.key === "Enter"
            const denyChord = event.key === "Escape" && !event.metaKey && !event.ctrlKey
            if (!approveChord && !denyChord) return
            // Something on top owns the keyboard. Both halves are load-bearing: Radix cancels
            // Escape for a dialog, menu or popover but still lets it reach us, and it never
            // touches Cmd+Enter, which only the overlay check catches.
            if (event.defaultPrevented || isOverlayOpen()) return
            // The listener is on `window`, and a parallel run parks a gate in a session you are
            // not looking at. Without this, one Cmd+Enter answered every hidden card too.
            if (rootRef.current && !isOnScreen(rootRef.current)) return
            if (rootRef.current && ownsShortcut && !ownsShortcut(rootRef.current)) return
            if (steerOpen) return
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

    // Every hook ran above: a card with no gate renders nothing.
    if (!current || !preview) return null

    // One state for the card, from the same function as the result rows. A recoverable answer
    // keeps the full card with the production retry text.
    const cardState = changeCallState({
        partState: "approval-requested",
        answered: answered && !recoverable,
        readOnly,
    })

    // Answered: the card shrinks to its result row until the tool result replaces it.
    if (cardState.kind === "waiting") {
        return (
            <div
                ref={rootRef}
                className="flex flex-col gap-1 rounded-[10px] border border-solid border-colorBorderSecondary bg-colorBgContainer py-1 shadow-[var(--ag-surface-card-shadow)]"
            >
                <ChangeResultRow state={cardState} />
                {errorText ? (
                    <p
                        role="alert"
                        aria-live="assertive"
                        className="m-0 px-3 pb-1 text-xs text-colorError"
                    >
                        {errorText}
                    </p>
                ) : null}
            </div>
        )
    }

    return (
        <div
            ref={rootRef}
            className={`flex flex-col ${
                changeCard
                    ? "overflow-hidden rounded-[10px] border border-solid border-colorBorderSecondary bg-colorBgContainer shadow-[var(--ag-surface-card-shadow)]"
                    : `rounded-lg ${className}`
            } ${risky ? "!border-colorWarningBorder" : ""}`}
        >
            {/* Eyebrow: a quiet cue that a decision is owed, not an error tint. A change card's
                header is the change itself, so it shows the eyebrow only once answered. */}
            {(changes || grouped) && !answered ? null : (
                <div className="flex items-center gap-1.5">
                    <ShieldCheck size={14} weight="fill" className="shrink-0 text-colorText" />
                    <span className="text-xs font-medium text-colorText">
                        {answered
                            ? t("chat.approvalCard.answerSavedRetry")
                            : t("chat.approvalCard.needsApproval")}
                    </span>
                </div>
            )}

            {/* The whole ask, in one sentence — what happens, and what it costs. */}
            {grouped ? (
                <div className="px-3 pb-3 pt-2.5">
                    <ChangeCallGroups previews={grouped} />
                </div>
            ) : changes ? (
                <ChangeSections
                    changes={changes}
                    proposedValues={preview.proposedValues}
                    cannotApply={preview.cannotApply}
                    agentName={versions.agentName ?? preview.agentName}
                    header={preview.header}
                    sentence={preview.sentence}
                />
            ) : (
                <span
                    className="text-[13px] leading-relaxed text-colorTextSecondary [text-wrap:pretty]"
                    title={current.toolName}
                >
                    {preview.sentence}
                </span>
            )}

            {changes && conflict ? (
                <div data-testid="change-conflict" className="mx-3 mb-2.5 mt-1.5">
                    <RiskLine>
                        {tChange("chat.changeCard.conflict", {
                            latest: latestVersion,
                            base: baseVersion,
                        })}
                    </RiskLine>
                </div>
            ) : null}

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
                            ? t("chat.approvalCard.hideDetails")
                            : t(
                                  batched
                                      ? "chat.approvalCard.seeWhatRuns"
                                      : "chat.approvalCard.seeWhatChanges",
                                  {count: items.length},
                              )}
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
            {cardState.kind === "read_only" ? (
                <ChangeResultRow
                    state={cardState}
                    readOnlyNote={readOnlyNote}
                    className={`rounded-md bg-colorFillQuaternary px-2.5 py-2 ${
                        changeCard ? "mx-2 mb-2" : "-mx-1"
                    }`}
                />
            ) : null}
            {readOnly ? null : (
                <HeightCollapse
                    className={changeCard ? "" : "-mt-1"}
                    open={!steerOpen && !answered}
                    fade
                    inert
                >
                    {/* Wraps rather than squeezes: with Redirect on, the buttons drop to their own line
                    instead of shoving Approve off a narrow screen. A change card puts the row in
                    its footer band (C01): the version note left, the buttons right. */}
                    <div
                        className={`flex flex-wrap items-center gap-2 ${
                            changeCard
                                ? `border-0 border-t border-solid border-colorBorderSecondary bg-[var(--ag-surface-raised)] ${
                                      phone ? "px-3 py-2" : "py-2 pl-3 pr-2.5"
                                  }`
                                : ""
                        }`}
                    >
                        {grouped ? (
                            <span className="text-xs text-colorTextSecondary">
                                {tStates("chat.changeCardStates.openRow")}
                            </span>
                        ) : changes && baseVersion !== undefined ? (
                            <span
                                className="text-xs leading-4 text-colorTextSecondary"
                                data-testid="change-saves-as"
                            >
                                {tChange("chat.changeCard.savesAs", {version: baseVersion + 1})}
                            </span>
                        ) : null}
                        {canAlwaysAllow ? (
                            <label
                                className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-colorTextSecondary ${
                                    phone ? "min-h-11" : ""
                                }`}
                            >
                                <Checkbox
                                    checked={alwaysAllowArmed}
                                    disabled={responding}
                                    onCheckedChange={(checked) =>
                                        setAlwaysAllowArmed(checked === true)
                                    }
                                    aria-labelledby={alwaysAllowLabelId}
                                    className="shrink-0"
                                />
                                <span id={alwaysAllowLabelId}>
                                    {t("chat.approvalCard.alwaysAutoApprove")}
                                </span>
                            </label>
                        ) : null}
                        <div
                            className={`ml-auto flex items-center gap-1.5 ${
                                // The 44 px phone buttons wrap rather than run off a narrow card.
                                phone ? "flex-wrap justify-end" : "shrink-0"
                            }`}
                        >
                            {steerEnabled ? (
                                <Button
                                    variant="ghost"
                                    size={buttonSize}
                                    disabled={responding}
                                    className={`text-colorTextSecondary ${actionCls}`}
                                    onClick={() => setSteerOpen(true)}
                                >
                                    {t("chat.approvalCard.redirect")}
                                </Button>
                            ) : null}
                            <LoadingButton
                                variant="ghost"
                                size={buttonSize}
                                disabled={responding}
                                loading={responding && firedAction === "deny"}
                                className={`${changeCard ? "text-colorTextSecondary" : ""} ${actionCls}`}
                                onClick={deny}
                                aria-keyshortcuts={shortcutAria("approval.deny")}
                            >
                                {batched && onDenyAll
                                    ? t("chat.approvalCard.denyAll")
                                    : t("chat.approvalCard.deny")}
                                {/* Decorative: the button's own label already names the action. */}
                                {showKeys ? (
                                    <ShortcutKeys
                                        id="approval.deny"
                                        aria-hidden
                                        className="ml-1.5"
                                    />
                                ) : null}
                            </LoadingButton>
                            <LoadingButton
                                variant={removes ? "destructive" : undefined}
                                size={buttonSize}
                                disabled={responding}
                                loading={responding && firedAction === "approve"}
                                className={actionCls}
                                onClick={approve}
                                aria-keyshortcuts={shortcutAria("approval.approve")}
                            >
                                {batched
                                    ? t("chat.approvalCard.approveAll")
                                    : removes
                                      ? tChange("chat.changeCard.remove")
                                      : t("chat.approvalCard.approve")}
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
            )}

            {/* Steer: an inline redirect note. Unmounted (not merely collapsed) while the flag is
                off — a collapsed HeightCollapse still leaves its controls in the tab order. */}
            {steerEnabled && !answered && !readOnly ? (
                <HeightCollapse open={steerOpen} fade inert>
                    <div
                        className={`flex flex-col gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-2.5 ${
                            changeCard ? "px-3 pb-3" : ""
                        }`}
                    >
                        <span className="text-xs text-colorTextSecondary">
                            {t("chat.approvalCard.steerHint")}
                        </span>
                        <AutosizeTextarea
                            ref={steerInputRef}
                            variant="filled"
                            autoSize={{minRows: 2, maxRows: 6}}
                            value={steerMessage}
                            onChange={(e) => setSteerMessage(e.target.value)}
                            placeholder={t("chat.approvalCard.steerPlaceholder")}
                            disabled={responding}
                            className="text-xs hover:border-colorBorder focus:border-colorBorder focus:shadow-none"
                        />
                        <div className="flex items-center justify-end gap-1.5">
                            <Button
                                variant="ghost"
                                disabled={responding}
                                className={actionCls}
                                onClick={() => setSteerOpen(false)}
                            >
                                {t("chat.approvalCard.cancel")}
                            </Button>
                            {/* Default, not primary: Approve is the card's single primary. */}
                            <Button
                                variant="outline"
                                disabled={responding || !steerMessage.trim()}
                                className={actionCls}
                                onClick={() => {
                                    setFiredAction("deny")
                                    onRespond({
                                        approvalId: current.approvalId,
                                        approved: false,
                                        message: steerMessage,
                                    })
                                }}
                            >
                                {t("chat.approvalCard.denyAndSend")}
                            </Button>
                        </div>
                    </div>
                </HeightCollapse>
            ) : null}

            {answered ? (
                <p
                    role="status"
                    aria-live="polite"
                    className={`m-0 text-xs text-colorTextSecondary ${changeCard ? "px-3 pb-3" : ""}`}
                >
                    {t("chat.approvalCard.answerSavedRetryHint")}
                </p>
            ) : null}
            {errorText ? (
                <p
                    role="alert"
                    aria-live="assertive"
                    className={`m-0 text-xs text-colorError ${changeCard ? "px-3 py-2" : ""}`}
                >
                    {errorText}
                </p>
            ) : null}
        </div>
    )
}
