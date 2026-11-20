/**
 * What a change card becomes after the answer (task 26.1): one row per call. "Waiting for the
 * agent" until the tool result arrives, then "Saved as vN" with View and Revert, "You denied this
 * change", or "Not saved" with the reason (a conflict offers "Try again"). A card that waits for
 * an answer this reader cannot give shows "Only the owner can approve". The state comes from
 * `changeCallState`; this file only draws it.
 */
import {useMemo, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"
import chatChangeCardStatesCatalog from "@agenta/i18n/catalogs/chat.changeCardStates"
import {Button} from "@agenta/ui/ui"
import {Check, CircleNotch, Lock, Warning, X} from "@phosphor-icons/react"

import {describeApproval} from "../model/approvalPreview"
import {
    answeredChangeCalls,
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
        className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
            tone === "added"
                ? "bg-colorSuccessBg text-colorSuccess"
                : tone === "removed"
                  ? "bg-colorErrorBg text-colorError"
                  : "bg-colorFillTertiary text-colorTextSecondary"
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
    /** Opens the revert of the saved version. */
    onRevert?: () => void
    /** Asks the builder to read the agent again (a conflict). */
    onTryAgain?: () => void
    /** Touch mode: the buttons keep the 44 px tap area of the card's buttons. */
    touch?: boolean
    /** The row's padding; a card that holds the row passes its own. */
    className?: string
}

export const ChangeResultRow = ({
    state,
    summary,
    readOnlyNote,
    onView,
    onRevert,
    onTryAgain,
    touch = false,
    className = "px-3 py-2",
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
            detail = t("chat.changeCardStates.answerSaved")
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
                        <Button variant="ghost" size="sm" className={touchCls} onClick={onView}>
                            {t("chat.changeCardStates.view")}
                        </Button>
                    ) : null}
                    {onRevert ? (
                        <Button variant="ghost" size="sm" className={touchCls} onClick={onRevert}>
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
                    <Button variant="outline" size="sm" className={touchCls} onClick={onTryAgain}>
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
    return (
        <div
            className={`flex min-w-0 items-center gap-2.5 ${className}`}
            data-testid={`change-result-${state.kind === "not_saved" ? state.reason : state.kind}`}
            {...(state.kind === "waiting" ? {role: "status", "aria-live": "polite" as const} : {})}
        >
            {mark}
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-colorText">{title}</span>
                {detail ? (
                    <span className="truncate text-xs text-colorTextSecondary" title={detail}>
                        {detail}
                    </span>
                ) : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
    )
}

/** The call's request title: its one change, or "{N} changes to {agent}". */
const useChangeCallSummary = (call: Pick<ChangeCall, "toolName" | "input">) => {
    const tChange = useT(chatChangeCardCatalog)
    const tStates = useT(chatChangeCardStatesCatalog)
    return useMemo(() => {
        const preview = describeApproval({
            approvalId: "",
            toolName: call.toolName,
            input: call.input,
        })
        if (preview.header) return preview.header.title
        const blocks = groupChanges(preview.changes ?? [])
        if (blocks.length === 1) return blocks[0].title
        if (!blocks.length) return undefined
        return preview.agentName
            ? tChange("chat.changeCard.changesTo", {count: blocks.length, agent: preview.agentName})
            : tStates("chat.changeCardStates.changesCount", {count: blocks.length})
    }, [call.toolName, call.input, tChange, tStates])
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
    const {onView, onRevert, onTryAgain} = actions ?? {}
    const saved = call.state.kind === "saved" ? call.state : null
    const workflowId = saved?.workflowId
    const viewed = workflowId && saved.revisionId ? {workflowId, revisionId: saved.revisionId} : null
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
    className = "border border-solid border-colorBorderSecondary bg-colorBgContainer",
}: {
    parts: readonly unknown[] | undefined
    actions?: ChangeResultActions
    /** The turn is over: a call with no result by now has no row. */
    finished?: boolean
    touch?: boolean
    className?: string
}) => {
    const calls = useMemo(() => answeredChangeCalls(parts ?? [], {finished}), [parts, finished])
    if (!calls.length) return null
    return (
        <div
            className={`flex min-w-0 flex-col rounded-lg py-1 ${className}`}
            data-testid="change-results"
        >
            {calls.map((call, index) => (
                <CallRow
                    key={call.toolCallId || index}
                    call={call}
                    actions={actions}
                    touch={touch}
                />
            ))}
        </div>
    )
}
