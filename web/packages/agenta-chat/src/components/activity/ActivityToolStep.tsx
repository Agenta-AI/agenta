import {
    memo,
    useEffect,
    useId,
    useMemo,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import type {FileActivity} from "@agenta/entities/session"
import {driveQuickLookAtomFamily, useDriveSessionId} from "@agenta/entity-ui/drive"
import {ArrowSquareOut, CaretDown, FileText} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {
    approvalVerdictText,
    isNonFinalRunnerError,
    isNotHandledOutput,
    isSettled,
    partToolName,
} from "../../model"
import {
    getChatSkinVersion,
    inSentence,
    resolveToolDisplay,
    subscribeChatSkin,
    type ResolvedToolDisplay,
} from "../../skin"
import {expandedValueAtomFamily, setExpandedAtom, toolRowKey} from "../../state"
import RevealCollapse from "../RevealCollapse"
import {ToolIOBlock} from "../ToolIOBlock"

import {ActivityNode, LIVE_TEXT_CLASS, type ActivityState} from "./activityIcons"

// `_skinVersion` only makes the registry's state part of the call, so a memo can key on it.
const displayFor = (
    part: ToolUIPart,
    appName?: string,
    _skinVersion?: number,
): ResolvedToolDisplay =>
    resolveToolDisplay(
        partToolName(part),
        (part as {input?: unknown}).input,
        appName,
        (part as {output?: unknown}).output,
    )

const stateOf = (part: ToolUIPart): ActivityState => {
    const state = part.state as string
    const output = (part as {output?: unknown}).output
    const errorText = (part as {errorText?: string}).errorText
    if (state === "approval-requested") return "awaiting"
    if (state === "output-denied") return "denied"
    if (state === "approval-responded") {
        const verdict = approvalVerdictText(part)
        return verdict === "approved" ? "approved" : verdict === "denied" ? "denied" : "responded"
    }
    if (state === "output-error") return isNonFinalRunnerError(errorText) ? "deferred" : "idle"
    if (state === "output-available") return isNotHandledOutput(output) ? "not-handled" : "idle"
    if (state === "input-streaming") return "queued"
    return isSettled(state) ? "idle" : "running"
}

const basename = (path: string): string => path.split("/").filter(Boolean).pop() ?? path

/** The verb, then the object set apart: "Read **ApprovalDock.tsx**". The detail (a filename, a
 * command) stands in for the generic object when the call has one. */
const Sentence = ({
    part,
    display,
    state,
}: {
    part: ToolUIPart
    display: ResolvedToolDisplay
    state: ActivityState
}) => {
    const landed = (part.state as string) === "output-available"
    const sentence = landed ? display.activity.done : display.activity.running
    const verb = display.verb ? (landed ? display.verb.done : display.verb.running) : null
    const object =
        display.detail ??
        (verb && sentence.startsWith(`${verb} `) ? sentence.slice(verb.length + 1) : null)
    const action = <strong className="font-medium">{inSentence(display.activity.running)}</strong>
    // A gate is written from the reader's side: what they are being asked, or what they said.
    if (state === "awaiting") return <>Needs your approval for {action}</>
    if (state === "approved") return <>You approved {action}</>
    if (state === "denied") return <>You denied {action}</>
    if (state === "responded") return <>You answered {action}</>
    if (verb && object) {
        return (
            <>
                {verb} <strong className="font-medium">{object}</strong>
            </>
        )
    }
    // No verb to split on: the detail still rides beside the plain sentence.
    return (
        <>
            {sentence}
            {display.detail ? (
                <>
                    {" "}
                    <strong className="font-medium">{display.detail}</strong>
                </>
            ) : null}
        </>
    )
}

/** Opens a file the step wrote in the Files pane. A no-op outside a drive-backed session. */
const useOpenFile = (): ((path: string) => void) | null => {
    const sessionId = useDriveSessionId()
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId ?? ""))
    return sessionId ? (path) => openQuickLook({path}) : null
}

const FileChips = ({
    files,
    onOpen,
}: {
    files: FileActivity[]
    onOpen: ((path: string) => void) | null
}) => (
    <div className="flex flex-wrap gap-1.5 pl-[38px]">
        {files.map((file) =>
            onOpen ? (
                <button
                    key={file.path}
                    type="button"
                    onClick={() => onOpen(file.path)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-solid border-colorBorderSecondary bg-transparent px-2 py-0.5 text-xs text-colorTextSecondary hover:bg-colorFillQuaternary"
                >
                    <FileText size={12} />
                    {basename(file.path)}
                </button>
            ) : (
                <span
                    key={file.path}
                    className="inline-flex items-center gap-1.5 rounded-md border border-colorBorderSecondary px-2 py-0.5 text-xs text-colorTextSecondary"
                >
                    <FileText size={12} />
                    {basename(file.path)}
                </span>
            ),
        )}
    </div>
)

interface StepViewProps {
    part: ToolUIPart
    files: FileActivity[]
    display: ResolvedToolDisplay
    logo?: string | null
    appLabel?: string
    /** The run's latest step while the run goes on: it reads live even once its call settled. */
    live?: boolean
}

const ActivityToolStepView = memo(({part, files, display, logo, appLabel, live}: StepViewProps) => {
    const state = stateOf(part)
    const input = (part as {input?: unknown}).input
    const output = (part as {output?: unknown}).output
    const errorText = (part as {errorText?: string}).errorText
    const rawState = part.state as string

    // Presence, not truthiness: a legit `null` output is real, and a missing `output` key must not
    // open an empty expander.
    const hasInput = input !== undefined
    const hasOutput = rawState === "output-available" && output !== undefined
    const hasNote = errorText !== undefined && state === "deferred"
    // A step that wrote one file opens that file; its payload is the file itself.
    const openFile = useOpenFile()
    const opensFile = files.length === 1 && openFile !== null
    const expandable = !opensFile && (hasInput || hasOutput || hasNote)

    const rowKey = toolRowKey(part.toolCallId ?? display.raw)
    const stored = useAtomValue(expandedValueAtomFamily(rowKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const open = expandable && (stored ?? false)
    const panelId = useId()
    // Format a payload only once opened; keep it mounted after so closing animates.
    const [everOpen, setEverOpen] = useState(open)
    useEffect(() => {
        if (open) setEverOpen(true)
    }, [open])

    // One file is already named in the sentence; a run of them gets chips.
    const chips = files.length > 1 ? files : []
    const others = chips.length ? chips.length - 1 : 0

    const header: ReactNode = (
        <>
            <ActivityNode
                icon={display.icon}
                state={state}
                logo={logo}
                appLabel={appLabel}
                yourTurn={display.icon === "ask" || display.icon === "connect"}
            />
            <span
                className={`min-w-0 truncate text-sm text-colorText transition-colors group-hover/row:text-colorTextSecondary ${
                    live || state === "running" || state === "queued" || state === "awaiting"
                        ? LIVE_TEXT_CLASS
                        : ""
                }`}
            >
                <Sentence part={part} display={display} state={state} />
                {others ? ` and ${others} other${others === 1 ? "" : "s"}` : null}
            </span>
            {opensFile ? (
                <ArrowSquareOut size={11} className="shrink-0 text-colorTextDisabled" />
            ) : expandable ? (
                <CaretDown
                    size={9}
                    weight="bold"
                    className={`shrink-0 text-colorTextDisabled opacity-50 transition-transform ${
                        open ? "rotate-180" : ""
                    }`}
                />
            ) : null}
        </>
    )

    const rowClass =
        "relative -ml-1.5 flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-3.5 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left group/row after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']"

    return (
        <div className="flex min-w-0 flex-col gap-2">
            {opensFile ? (
                <button type="button" onClick={() => openFile(files[0].path)} className={rowClass}>
                    {header}
                </button>
            ) : expandable ? (
                <button
                    type="button"
                    onClick={() => setExpanded({key: rowKey, value: !open})}
                    aria-expanded={open}
                    aria-controls={panelId}
                    // The `after` box is the ~44px touch target; the row's own chrome never grows.
                    className={rowClass}
                >
                    {header}
                </button>
            ) : (
                <div className="flex min-w-0 items-center gap-3.5 py-0.5">{header}</div>
            )}
            {chips.length ? <FileChips files={chips} onOpen={openFile} /> : null}
            <RevealCollapse open={open}>
                <div id={panelId} className="flex min-w-0 flex-col gap-2 pl-[38px]">
                    {everOpen ? (
                        <>
                            {hasInput ? <ToolIOBlock label="input" value={input} /> : null}
                            {hasNote ? (
                                <ToolIOBlock label="note" value={errorText} />
                            ) : hasOutput ? (
                                <ToolIOBlock label="result" value={output} />
                            ) : null}
                        </>
                    ) : null}
                </div>
            </RevealCollapse>
        </div>
    )
})
ActivityToolStepView.displayName = "ActivityToolStepView"

/**
 * Re-resolve once the catalog names the app ("GitHub", not "Github") and hands over its logo.
 * Mounted only for rows with a `sourceKey`, so shell, file and platform steps subscribe to nothing.
 */
const CatalogToolStep = ({
    part,
    files,
    base,
    live,
}: {
    part: ToolUIPart
    files: FileActivity[]
    base: ResolvedToolDisplay
    live?: boolean
}) => {
    const {integration} = useToolIntegrationDetail(base.sourceKey ?? "")
    const name = integration?.name
    const display = useMemo(() => (name ? displayFor(part, name) : base), [part, base, name])
    return (
        <ActivityToolStepView
            part={part}
            files={files}
            display={display}
            logo={integration?.logo ?? null}
            appLabel={name}
            live={live}
        />
    )
}

/** One tool call on the timeline: kind node, sentence, tap for its input and result. */
export const ActivityToolStep = ({
    part,
    files,
    live,
}: {
    part: ToolUIPart
    files: FileActivity[]
    live?: boolean
}) => {
    // A skin registered after this row mounted (the agent's own tools arrive with its config)
    // has to reach rows already on screen.
    const skinVersion = useSyncExternalStore(
        subscribeChatSkin,
        getChatSkinVersion,
        getChatSkinVersion,
    )
    const base = useMemo(() => displayFor(part, undefined, skinVersion), [part, skinVersion])
    if (base.sourceKey) {
        return <CatalogToolStep part={part} files={files} base={base} live={live} />
    }
    return <ActivityToolStepView part={part} files={files} display={base} live={live} />
}
