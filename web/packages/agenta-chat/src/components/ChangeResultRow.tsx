/**
 * What a change card becomes after the answer (task 26.1): one row per call. "Waiting for the
 * agent" until the tool result arrives, then "Saved as vN" with View and Revert, "You denied this
 * change", or "Not saved" with the reason (a conflict offers "Try again"). A card that waits for
 * an answer this reader cannot give shows "Only the owner can approve". The state comes from
 * `changeCallState`; this file only draws it.
 *
 * A call the person's "always approve" ran with no card keeps the same row, marked "Approved
 * automatically", with "Turn off" while the choice is on (design D32). A test start the choice
 * ran gets one row too: what the card would have asked, and the same mark.
 */
import {useMemo, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"
import chatChangeCardStatesCatalog from "@agenta/i18n/catalogs/chat.changeCardStates"
import {Button} from "@agenta/ui/ui"
import {Check, CircleNotch, Lock, Warning, X} from "@phosphor-icons/react"

import {useAgentDisplayName} from "../hooks/useAgentDisplayName"
import {useChangeVersions} from "../hooks/useChangeVersions"
import {agentCallTarget} from "../model/approvalDescribers/describeAgentChanges"
import {describeApproval} from "../model/approvalPreview"
import {
    answeredChangeCalls,
    autoApprovedCalls,
    type AutoApprovedCall,
    type ChangeCall,
    type ChangeCallState,
    type NotSavedReason,
} from "../model/changeCallState"

import {groupChanges} from "./ChangeSections"

type RowState = Exclude<ChangeCallState, {kind: "pending"}>

const REASON_KEY: Record<
    NotSavedReason,
    | "chat.changeCardStates.reasonConflict"
    | "chat.changeCardStates.reasonAccessDenied"
    | "chat.changeCardStates.reasonInvalidConfiguration"
    | "chat.changeCardStates.reasonNoChange"
    | "chat.changeCardStates.reasonFailed"
> = {
    conflict: "chat.changeCardStates.reasonConflict",
    access_denied: "chat.changeCardStates.reasonAccessDenied",
    invalid_configuration: "chat.changeCardStates.reasonInvalidConfiguration",
    no_change: "chat.changeCardStates.reasonNoChange",
    failed: "chat.changeCardStates.reasonFailed",
}

const Mark = ({tone, children}: {tone: "plain" | "added" | "removed"; children: ReactNode}) => (
    <span
        aria-hidden
        // A 16 px tile, radius 4 (C01 status rows).
        className={`flex size-4 shrink-0 items-center justify-center rounded ${
            tone === "added"
                ? "bg-colorSuccessBg text-colorSuccess"
                : tone === "removed"
                  ? "bg-colorErrorBg text-colorError"
                  : "bg-colorSplit text-colorTextSecondary"
        }`}
    >
        {children}
    </span>
)

export interface ChangeResultRowProps {
    state: RowState
    /** What the call changed, for the saved row ("3 changes to Support triage"). */
    summary?: string
    /** The host's words for who can answer, in place of "You can read this chat.". */
    readOnlyNote?: string | null
    /** Opens the version history on the saved version. */
    onView?: () => void
    /** Opens the revert to the version the call changed. */
    onRevert?: () => void
    /** Asks the builder to read the agent again (a conflict). */
    onTryAgain?: () => void
    /** The person's approval choice answered the call: the row says so. */
    autoApproved?: boolean
    /** Turns the person's approval choice for the tool off; shown while it is on. */
    onTurnOff?: () => void
    /** Touch mode: the buttons keep the 44 px tap area of the card's buttons. */
    touch?: boolean
    /** The row's padding; a card that holds the row passes its own. */
    className?: string
}

const TurnOffButton = ({onClick, className}: {onClick: () => void; className: string}) => {
    const t = useT(chatChangeCardStatesCatalog)
    return (
        <Button variant="ghost" size="compact" className={className} onClick={onClick}>
            {t("chat.changeCardStates.turnOff")}
        </Button>
    )
}

export const ChangeResultRow = ({
    state,
    summary,
    readOnlyNote,
    onView,
    onRevert,
    onTryAgain,
    autoApproved = false,
    onTurnOff,
    touch = false,
    className = "px-3 py-[7px]",
}: ChangeResultRowProps) => {
    const t = useT(chatChangeCardStatesCatalog)
    const tChange = useT(chatChangeCardCatalog)
    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""
    let mark: ReactNode
    let title: string
    let detail: string | undefined
    let actions: ReactNode = null
    switch (state.kind) {
        case "waiting":
            mark = (
                <Mark tone="plain">
                    <CircleNotch size={12} className="animate-spin" />
                </Mark>
            )
            title = t("chat.changeCardStates.waiting")
            detail = autoApproved
                ? t("chat.changeCardStates.autoApproved")
                : t("chat.changeCardStates.answerSaved")
            break
        case "saved":
            mark = (
                <Mark tone="added">
                    <Check size={12} weight="bold" />
                </Mark>
            )
            title = state.version
                ? tChange("chat.changeCard.savedAs", {version: state.version})
                : t("chat.changeCardStates.saved")
            detail = summary
            actions = (
                <>
                    {onView ? (
                        <Button
                            variant="ghost"
                            size="compact"
                            className={touchCls}
                            onClick={onView}
                        >
                            {t("chat.changeCardStates.view")}
                        </Button>
                    ) : null}
                    {onRevert ? (
                        <Button
                            variant="ghost"
                            size="compact"
                            className={touchCls}
                            onClick={onRevert}
                        >
                            {t("chat.changeCardStates.revert")}
                        </Button>
                    ) : null}
                </>
            )
            break
        case "denied":
            mark = (
                <Mark tone="plain">
                    <X size={12} weight="bold" />
                </Mark>
            )
            title = t("chat.changeCardStates.denied")
            detail = t("chat.changeCardStates.nothingSaved")
            break
        case "not_saved":
            mark = (
                <Mark tone="removed">
                    <Warning size={12} weight="bold" />
                </Mark>
            )
            title = t("chat.changeCardStates.notSaved")
            detail = t(REASON_KEY[state.reason])
            actions =
                state.reason === "conflict" && onTryAgain ? (
                    <Button
                        variant="outline"
                        size="compact"
                        className={touchCls}
                        onClick={onTryAgain}
                    >
                        {t("chat.changeCardStates.tryAgain")}
                    </Button>
                ) : null
            break
        case "read_only":
            mark = (
                <Mark tone="plain">
                    <Lock size={12} weight="bold" />
                </Mark>
            )
            title = t("chat.changeCardStates.readOnly")
            detail = readOnlyNote || t("chat.changeCardStates.readOnlyDetail")
            break
    }
    // The waiting row already says it in its detail line.
    const note =
        autoApproved && state.kind !== "waiting"
            ? t("chat.changeCardStates.autoApproved")
            : undefined
    return (
        <ResultRowFrame
            mark={mark}
            title={title}
            detail={detail}
            note={note}
            actions={
                actions || onTurnOff ? (
                    <>
                        {actions}
                        {onTurnOff ? (
                            <TurnOffButton onClick={onTurnOff} className={touchCls} />
                        ) : null}
                    </>
                ) : null
            }
            className={className}
            testId={`change-result-${state.kind === "not_saved" ? state.reason : state.kind}`}
            status={state.kind === "waiting"}
            autoApproved={autoApproved}
        />
    )
}

/** The layout every result row shares: the mark, the text lines, the buttons. */
const ResultRowFrame = ({
    mark,
    title,
    detail,
    note,
    actions,
    className,
    testId,
    status = false,
    autoApproved = false,
}: {
    mark: ReactNode
    title: string
    detail?: string
    /** A third line, under the detail. */
    note?: string
    actions: ReactNode
    className: string
    testId: string
    status?: boolean
    autoApproved?: boolean
}) => (
    <div
        className={`flex min-w-0 items-center gap-2 ${className}`}
        data-testid={testId}
        {...(autoApproved ? {"data-auto-approved": true} : {})}
        {...(status ? {role: "status", "aria-live": "polite" as const} : {})}
    >
        {mark}
        <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-colorText">{title}</span>
            {detail ? (
                <span
                    className="truncate text-[12px] leading-4 text-colorTextSecondary"
                    title={detail}
                >
                    {detail}
                </span>
            ) : null}
            {note ? (
                <span className="truncate text-[12px] leading-4 text-colorTextSecondary">
                    {note}
                </span>
            ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
)

/**
 * A test start (or any other call that is not a change) that the person's approval choice ran
 * with no card: what the card would have asked (the tool and its readable arguments, such as the
 * agent and the first message), marked "Approved automatically".
 */
const AutoApprovedCallRow = ({
    call,
    onTurnOff,
    touch = false,
    className = "px-3 py-[7px]",
}: {
    call: AutoApprovedCall
    onTurnOff?: () => void
    touch?: boolean
    className?: string
}) => {
    const t = useT(chatChangeCardStatesCatalog)
    // Not memoized: the describers translate with the active language, which can change.
    const approval = {approvalId: "", toolName: call.toolName, input: call.input}
    // A test start names its agent by a slug or an id: describe it again with the agent's name.
    const agentName = useAgentDisplayName(describeApproval(approval).agentRef)
    const preview = describeApproval(approval, undefined, null, agentName)
    const detail = (preview.items ?? [])
        .map((item) => (item.detail ? `${item.title}: ${item.detail}` : item.title))
        .join(" · ")
    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""
    return (
        <ResultRowFrame
            mark={
                <Mark tone="added">
                    <Check size={12} weight="bold" />
                </Mark>
            }
            title={preview.sentence}
            detail={detail || undefined}
            note={t("chat.changeCardStates.autoApproved")}
            actions={onTurnOff ? <TurnOffButton onClick={onTurnOff} className={touchCls} /> : null}
            className={className}
            testId="change-result-auto-approved"
            autoApproved
        />
    )
}

/** The call's request title: its one change, or "{N} changes to {agent}". */
const useChangeCallSummary = (call: Pick<ChangeCall, "toolName" | "input">) => {
    const tChange = useT(chatChangeCardCatalog)
    const tStates = useT(chatChangeCardStatesCatalog)
    // Not memoized: the describers translate with the active language, which can change.
    const preview = describeApproval({
        approvalId: "",
        toolName: call.toolName,
        input: call.input,
    })
    const blocks = groupChanges(preview.changes ?? [])
    // The call may name the agent by its id: the name comes from the base revision's agent.
    const agentName = useChangeVersions(preview.base).agentName ?? preview.agentName
    if (preview.header) return preview.header.title
    if (blocks.length === 1) return blocks[0].title
    if (!blocks.length) return undefined
    return agentName
        ? tChange("chat.changeCard.changesTo", {count: blocks.length, agent: agentName})
        : tStates("chat.changeCardStates.changesCount", {count: blocks.length})
}

/** A version of an agent, as the version history opens it. */
export interface ChangeVersionRef {
    workflowId: string
    revisionId: string
}

/** What a host does from a result row. Each one is optional: a missing one hides its button. */
export interface ChangeResultActions {
    /** Show the saved version. */
    onView?: (version: ChangeVersionRef) => void
    /** Go back to the version the call changed. */
    onRevert?: (version: ChangeVersionRef) => void
    /** Ask the builder to read the agent again. */
    onTryAgain?: () => void
    /** The person's "always approve" per tool: whether it is on, and turning it off. */
    autoApprove?: {
        isOn: (toolName: string) => boolean
        turnOff: (toolName: string) => void
    }
}

const CallRow = ({
    call,
    actions,
    touch,
}: {
    call: ChangeCall
    actions?: ChangeResultActions
    touch?: boolean
}) => {
    const summary = useChangeCallSummary(call)
    const {onView, onRevert, onTryAgain, autoApprove} = actions ?? {}
    const saved = call.state.kind === "saved" ? call.state : null
    const workflowId = saved?.workflowId
    const viewed =
        workflowId && saved.revisionId ? {workflowId, revisionId: saved.revisionId} : null
    const base =
        workflowId && call.baseRevisionId ? {workflowId, revisionId: call.baseRevisionId} : null
    return (
        <ChangeResultRow
            state={call.state as RowState}
            summary={summary}
            touch={touch}
            onView={viewed && onView ? () => onView(viewed) : undefined}
            onRevert={base && onRevert ? () => onRevert(base) : undefined}
            onTryAgain={onTryAgain}
            autoApproved={Boolean(call.autoApproved)}
            onTurnOff={
                call.autoApproved && autoApprove?.isOn(call.toolName)
                    ? () => autoApprove.turnOff(call.toolName)
                    : undefined
            }
        />
    )
}

/**
 * The result rows of one message's change calls, in message order: each call keeps its own row,
 * also when several calls were answered with one "Approve all". A call that still waits for an
 * answer has no row (the approval dock shows its card).
 */
export const ChangeResultRows = ({
    parts,
    actions,
    finished = false,
    touch = false,
    className = "border border-solid border-colorBorderSecondary bg-colorBgContainer shadow-[var(--ag-surface-card-shadow)]",
}: {
    parts: readonly unknown[] | undefined
    actions?: ChangeResultActions
    /** The turn is over: a call with no result by now has no row. */
    finished?: boolean
    touch?: boolean
    className?: string
}) => {
    const calls = useMemo(() => answeredChangeCalls(parts ?? [], {finished}), [parts, finished])
    const started = useMemo(() => autoApprovedCalls(parts ?? []), [parts])
    if (!calls.length && !started.length) return null
    // "Try again" only where the builder did not recover: a later call of the turn that saved the
    // same agent has already made the change on the new version.
    const recovered = (index: number) => {
        const agent = agentCallTarget(calls[index].input)
        return calls
            .slice(index + 1)
            .some((later) => later.state.kind === "saved" && agentCallTarget(later.input) === agent)
    }
    return (
        <div
            // One stacked status card (C01): rows split by a hairline.
            className={`flex min-w-0 flex-col divide-y divide-solid divide-colorSplit rounded-[10px] py-1 ${className}`}
            data-testid="change-results"
        >
            {calls.map((call, index) => (
                <CallRow
                    key={call.toolCallId || index}
                    call={call}
                    actions={recovered(index) ? {...actions, onTryAgain: undefined} : actions}
                    touch={touch}
                />
            ))}
            {started.map((call) => (
                <AutoApprovedCallRow
                    key={call.toolCallId}
                    call={call}
                    touch={touch}
                    onTurnOff={
                        actions?.autoApprove?.isOn(call.toolName)
                            ? () => actions.autoApprove?.turnOff(call.toolName)
                            : undefined
                    }
                />
            ))}
        </div>
    )
}
