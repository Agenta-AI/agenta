/**
 * The docked question card — one question at a time, pinned above the composer.
 *
 * It replaces an inline transcript card that held every field at once. Two properties are the whole
 * point and must survive any edit:
 *
 *  - **The card never moves the composer.** Every state renders into the same `CARD_MIN_H` box, and
 *    every slot holds its space whether or not it has content: the nav renders disabled at one
 *    question, the counter is tabular, and the error line is permanently mounted and merely empty.
 *    A `return null` on any branch, or a slot that only appears when filled, reintroduces the shift.
 *  - **It docks like its siblings.** It sits between `ApprovalDock` and `ConnectionDock`, in that
 *    order, because that is also the keyboard precedence (approval > elicitation > connect).
 *
 * Escape here does NOT settle, unlike `ApprovalCard` and `ConnectionDock`. This card owns a text
 * field, and Escape-to-back-out-of-typing is the stronger expectation; dismissing is the header ✕.
 */
import {useCallback, useEffect, useMemo, useRef} from "react"

import {
    buildAcceptResult,
    buildCancelResult,
    buildDeclineResult,
    buildElicitationSteps,
    formatStepValue,
    parseElicitationPayload,
    parseSecretRefusal,
    serializeElicitationContent,
    type ElicitationRequestPayload,
} from "@agenta/shared/utils"
import {Button} from "@agenta/ui/ui"
import {CaretLeft, CaretRight, Prohibit, Question, X} from "@phosphor-icons/react"

import type {ClientToolOutputHandler} from "../clientTools/ClientToolPart"
import type {ElicitationDockState} from "../hooks/useElicitationDock"
import {useElicitationStepper} from "../hooks/useElicitationStepper"
import type {ClientToolMeta} from "../skin"

import {
    ElicitationControl,
    MAX_DIGIT_ROWS,
    isMultiSelect,
    optionRowsFor,
    type OptionRow,
} from "./elicitation/ElicitationControl"

/** The reserved box. Every state fills it, so answering never moves the composer. */
const CARD_MIN_H = 168
/** The control area's floor, so a one-line input reserves as much room as a short option list. */
const CONTROL_MIN_H = 62

const CARD_SURFACE =
    "rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer"

export interface ElicitationDockProps {
    elicits: ElicitationDockState
    onOutput: ClientToolOutputHandler
    /** Display label of the tool that parked this, when it isn't the platform's own. */
    askerLabel?: string | null
    /** Invisibly extended tap area; the chrome stays identical. */
    touch?: boolean
    /** False while the host keeps the dock mounted purely to animate it closed. */
    active?: boolean
    className?: string
}

/** A settled or unrenderable card still holds the box while the host animates the collapse. */
const Shell = ({children, className}: {children: React.ReactNode; className?: string}) => (
    <div
        className={`${CARD_SURFACE} flex flex-col gap-2.5 p-3 px-3.5 shadow-sm ${className ?? ""}`}
        style={{minHeight: CARD_MIN_H}}
    >
        {children}
    </div>
)

export const ElicitationDock = ({
    elicits,
    onOutput,
    askerLabel,
    touch,
    active = true,
    className,
}: ElicitationDockProps) => {
    const {front} = elicits
    if (!front) return null
    // Keyed by the parked call: a new question resets every answer, timer and cursor.
    return (
        <div className={className}>
            <ElicitationCard
                key={front.toolCallId}
                meta={front}
                onOutput={onOutput}
                askerLabel={askerLabel}
                touch={touch}
                active={active}
                shortcutsEnabled={elicits.shortcutsEnabled}
            />
        </div>
    )
}

const ElicitationCard = ({
    meta,
    onOutput,
    askerLabel,
    touch,
    active,
    shortcutsEnabled,
}: {
    meta: ClientToolMeta
    onOutput: ClientToolOutputHandler
    askerLabel?: string | null
    touch?: boolean
    active: boolean
    shortcutsEnabled: boolean
}) => {
    const parsed = useMemo(() => parseElicitationPayload(meta.input), [meta.input])

    // One settle per card. `meta.settled` only flips after the host's durable write resolves, so the
    // buttons stay live in between without this latch.
    const settledRef = useRef(false)
    const settle = useCallback(
        (output: Record<string, unknown>) => {
            if (settledRef.current) return
            settledRef.current = true
            onOutput({toolName: meta.toolName, toolCallId: meta.toolCallId, output})
        },
        [onOutput, meta.toolName, meta.toolCallId],
    )

    if (!parsed.ok) {
        return (
            <RefusalPanel
                reason={parsed.reason}
                onSkip={() => settle(toOutput(buildCancelResult("Dismissed the request.")))}
            />
        )
    }

    return (
        <LiveCard
            payload={parsed.payload}
            meta={meta}
            askerLabel={askerLabel}
            touch={touch}
            active={active}
            shortcutsEnabled={shortcutsEnabled}
            settle={settle}
        />
    )
}

const toOutput = (result: {action: string; content?: unknown; humanFriendlyMessage?: string}) =>
    result as unknown as Record<string, unknown>

/**
 * A payload the dialect refuses. The dock has already settled it (see `useElicitationDock`), so this
 * panel is transient — the durable explanation is the transcript row. It holds the box meanwhile.
 */
const RefusalPanel = ({reason, onSkip}: {reason: string; onSkip: () => void}) => {
    const secret = parseSecretRefusal(reason)
    return (
        <Shell>
            <Eyebrow />
            <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex items-start gap-2">
                    <Prohibit size={14} className="mt-0.5 shrink-0 text-colorWarning" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] font-medium">
                            {secret
                                ? `This request asked for an ${secret.property} — forms never carry secrets.`
                                : "This request couldn't be shown as a form."}
                        </span>
                        <span className="text-xs text-colorTextSecondary">
                            {secret
                                ? "Connect the credential instead; the agent resumes as soon as it lands."
                                : reason}
                        </span>
                    </div>
                </div>
            </div>
            <div className="flex flex-row-reverse items-center gap-2">
                <Button variant="ghost" onClick={onSkip}>
                    Skip
                </Button>
            </div>
        </Shell>
    )
}

const Eyebrow = ({label, children}: {label?: string | null; children?: React.ReactNode}) => (
    <div className="flex items-center gap-2">
        <Question size={13} weight="fill" className="shrink-0 text-colorText" />
        <span className="text-xs font-medium text-colorText">{label || "Request input"}</span>
        {children}
    </div>
)

const LiveCard = ({
    payload,
    meta,
    askerLabel,
    touch,
    active,
    shortcutsEnabled,
    settle,
}: {
    payload: ElicitationRequestPayload
    meta: ClientToolMeta
    askerLabel?: string | null
    touch?: boolean
    active: boolean
    shortcutsEnabled: boolean
    settle: (output: Record<string, unknown>) => void
}) => {
    const cardRef = useRef<HTMLDivElement>(null)
    const form = useMemo(() => buildElicitationSteps(payload), [payload])

    const complete = useCallback(
        (content: Record<string, unknown>) => {
            settle(
                toOutput(
                    buildAcceptResult(
                        serializeElicitationContent(payload, content),
                        "Provided the requested input.",
                    ),
                ),
            )
        },
        [payload, settle],
    )

    const stepper = useElicitationStepper({
        form,
        toolCallId: meta.toolCallId,
        onComplete: complete,
    })
    const {step, steps, values, cursor, isReview} = stepper

    const rows = useMemo(() => optionRowsFor(step), [step])

    const settleAnd = useCallback(
        (output: Record<string, unknown>) => {
            stepper.discardDraft()
            settle(output)
        },
        [stepper, settle],
    )

    const multi = isMultiSelect(step)

    /** Focus the trailing "Other" text field. It is a row you type into, never one you pick. */
    const focusOther = useCallback(
        (index: number) => {
            stepper.setCursor(index)
            requestAnimationFrame(() =>
                cardRef.current
                    ?.querySelector<HTMLInputElement>("[data-elicitation-other]")
                    ?.focus({preventScroll: true}),
            )
        },
        [stepper],
    )

    const pickRow = useCallback(
        (row: OptionRow, index: number, immediate = false) => {
            if (!step) return
            // Digits and Enter used to die here on the Other row, because it carries no value.
            if (row.value === null) return focusOther(index)
            if (multi) return stepper.toggle(step.name, row.value)
            const value = step.kind === "boolean" ? row.value === "true" : row.value
            stepper.pick(step.name, value, `Picked ${row.label}`, index, immediate)
        },
        [step, stepper, multi, focusOther],
    )

    const toggleRow = useCallback(
        (row: OptionRow, index: number) => {
            if (!step) return
            if (row.value === null) return focusOther(index)
            stepper.toggle(step.name, row.value)
        },
        [step, stepper, focusOther],
    )

    // Row-driven steps and the review list put focus on the card itself, so digits and arrows work
    // immediately. Free-text steps focus their input instead (see ElicitationControl).
    useEffect(() => {
        if ((!rows.length && !isReview) || !active) return
        const frame = requestAnimationFrame(() => cardRef.current?.focus({preventScroll: true}))
        return () => cancelAnimationFrame(frame)
    }, [rows.length, isReview, stepper.index, active])

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!active || !shortcutsEnabled || event.repeat) return
        const mod = event.metaKey || event.ctrlKey
        const target = event.target as HTMLElement | null
        const typing =
            !!target &&
            (target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable)

        if (mod && event.key === "Enter") {
            event.preventDefault()
            stepper.primary()
            return
        }
        if (mod && event.key === "ArrowLeft") {
            event.preventDefault()
            stepper.back()
            return
        }
        if (mod && event.key === "ArrowRight") {
            event.preventDefault()
            stepper.forward()
            return
        }
        if (mod && (event.key === "Backspace" || event.key === "Delete")) {
            event.preventDefault()
            stepper.skip()
            return
        }
        if (mod) return

        // Escape backs out of typing rather than settling — see the note at the top of this file.
        if (event.key === "Escape") {
            if (stepper.hold) {
                event.preventDefault()
                stepper.cancelHold()
                return
            }
            if (typing) (target as HTMLElement).blur()
            return
        }

        // A date step parks focus on the picker's trigger, where Enter would open the calendar.
        // Keep Enter meaning "next", as it does in every other field; Space still opens the
        // picker, and once it is open its keys never reach here (Radix portals the content).
        if (
            event.key === "Enter" &&
            !typing &&
            (step?.kind === "date" || step?.kind === "date-time")
        ) {
            event.preventDefault()
            stepper.primary()
            return
        }

        // The review screen is a list of answers: walk it and press Enter to go fix one.
        if (isReview) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                stepper.moveCursor(event.key === "ArrowDown" ? 1 : -1, steps.length)
                return
            }
            if (event.key === "Enter" && !typing) {
                event.preventDefault()
                stepper.goTo(cursor)
            }
            return
        }

        // Digits and arrows belong to the input whenever one is focused.
        if (!rows.length || typing) return
        if (/^[1-9]$/.test(event.key)) {
            const index = Number(event.key) - 1
            if (index < Math.min(rows.length, MAX_DIGIT_ROWS)) {
                event.preventDefault()
                // Keyboard picks advance at once: the user meant it, and the hold that protects a
                // misclick just fights fast entry.
                pickRow(rows[index], index, true)
            }
            return
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            stepper.moveCursor(event.key === "ArrowDown" ? 1 : -1, rows.length)
            return
        }
        if (event.key === "Home" || event.key === "End") {
            event.preventDefault()
            stepper.setCursor(event.key === "Home" ? 0 : rows.length - 1)
            return
        }
        // Space toggles the cursor row on a multi-select, matching a real checkbox list.
        if (event.key === " " && multi) {
            event.preventDefault()
            const row = rows[cursor]
            if (row) toggleRow(row, cursor)
            return
        }
        if (event.key === "Enter") {
            event.preventDefault()
            const row = rows[cursor]
            if (row) pickRow(row, cursor, true)
        }
    }

    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""

    return (
        <div
            ref={cardRef}
            tabIndex={-1}
            role="group"
            aria-label={
                step ? `Question ${stepper.position} of ${stepper.total}` : "Review answers"
            }
            onKeyDownCapture={onKeyDown}
            onPointerDownCapture={stepper.cancelHold}
            className={`${CARD_SURFACE} flex flex-col gap-2.5 p-3 px-3.5 shadow-sm outline-none`}
            style={{minHeight: CARD_MIN_H}}
        >
            <Eyebrow label={askerLabel}>
                <div className="ml-auto flex items-center gap-0.5">
                    <NavButton
                        label="Previous question"
                        disabled={!stepper.canGoBack}
                        onClick={stepper.back}
                    >
                        <CaretLeft size={11} />
                    </NavButton>
                    <span
                        aria-live="polite"
                        className="min-w-[26px] text-center text-[11px] tabular-nums text-colorTextTertiary"
                    >
                        {stepper.position}/{stepper.total}
                    </span>
                    <NavButton
                        label="Next question"
                        disabled={!stepper.canGoForward}
                        onClick={stepper.forward}
                    >
                        <CaretRight size={11} />
                    </NavButton>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Dismiss"
                        aria-label="Dismiss this request"
                        onClick={() =>
                            settleAnd(toOutput(buildCancelResult("Dismissed the request.")))
                        }
                        className={`ml-1 size-[22px] text-colorTextQuaternary hover:text-colorText ${touchCls}`}
                    >
                        <X size={11} />
                    </Button>
                </div>
            </Eyebrow>

            <div className="flex gap-1" aria-hidden>
                {steps.map((candidate, index) => (
                    <span
                        key={candidate.name}
                        className={`h-0.5 flex-1 rounded-full ${
                            index < stepper.position ? "bg-colorText" : "bg-colorFillTertiary"
                        }`}
                    />
                ))}
            </div>

            <div className="flex flex-col gap-2" style={{minHeight: CONTROL_MIN_H}}>
                {isReview ? (
                    <ReviewList stepper={stepper} />
                ) : step ? (
                    <>
                        <span className="text-[13px] font-medium leading-tight line-clamp-2">
                            <span className="text-colorTextTertiary">{stepper.position}.</span>{" "}
                            {step.label}
                            {step.hint ? (
                                <span className="font-normal text-colorTextQuaternary">
                                    {" "}
                                    · {step.hint}
                                </span>
                            ) : null}
                        </span>
                        <ElicitationControl
                            step={step}
                            value={values[step.name]}
                            cursor={cursor}
                            touch={touch}
                            onChange={(value) => stepper.setValue(step.name, value)}
                            onPick={pickRow}
                            onToggle={toggleRow}
                            onCursor={stepper.setCursor}
                            onSubmit={stepper.primary}
                        />
                    </>
                ) : null}
            </div>

            <div className="flex flex-row-reverse items-center gap-2">
                <Button className={touchCls} onClick={stepper.primary}>
                    {stepper.primaryLabel}
                </Button>
                <Button
                    variant="outline"
                    className={touchCls}
                    onClick={() =>
                        isReview
                            ? settleAnd(toOutput(buildDeclineResult("Declined the request.")))
                            : stepper.skip()
                    }
                >
                    {isReview ? "Decline" : "Skip"}
                </Button>
                <span
                    aria-live="polite"
                    className={`mr-auto truncate text-xs ${
                        stepper.error ? "text-colorError" : "text-colorTextTertiary"
                    }`}
                >
                    {stepper.error ?? stepper.hold ?? ""}
                </span>
            </div>
        </div>
    )
}

const NavButton = ({
    label,
    disabled,
    onClick,
    children,
}: {
    label: string
    disabled: boolean
    onClick: () => void
    children: React.ReactNode
}) => (
    <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        // Rendered even when there is nowhere to go: a slot that appears on demand shifts the row.
        className="size-[22px] text-colorTextSecondary disabled:opacity-40"
    >
        {children}
    </Button>
)

const ReviewList = ({stepper}: {stepper: ReturnType<typeof useElicitationStepper>}) => (
    <>
        <span className="text-[13px] font-medium leading-tight">
            Review your answers{" "}
            <span className="font-normal text-colorTextQuaternary">
                · {stepper.answeredCount} answered
                {stepper.skippedCount > 0 ? ` · ${stepper.skippedCount} skipped` : ""}
            </span>
        </span>
        <div className="flex flex-col gap-0.5 overflow-y-auto" style={{maxHeight: 220}}>
            {stepper.steps.map((step, index) => (
                <button
                    key={step.name}
                    type="button"
                    onMouseEnter={() => stepper.setCursor(index)}
                    onClick={() => stepper.goTo(index)}
                    // `border-transparent` is load-bearing: the app's button reset paints a border,
                    // so a bare <button> here drew an outline around every row.
                    className={`flex h-[30px] min-w-0 cursor-pointer items-center justify-between gap-3 rounded-md border border-transparent bg-transparent px-2 text-left ${
                        index === stepper.cursor ? "bg-colorFillSecondary" : ""
                    }`}
                >
                    <span className="max-w-[55%] shrink-0 truncate text-xs text-colorTextSecondary">
                        {step.label}
                    </span>
                    <span
                        className={`min-w-0 truncate text-xs ${
                            stepper.isAnswered(step) ? "text-colorText" : "text-colorTextQuaternary"
                        }`}
                    >
                        {stepper.isAnswered(step)
                            ? formatStepValue(step, stepper.values[step.name])
                            : "Skipped"}
                    </span>
                </button>
            ))}
        </div>
    </>
)

export default ElicitationDock
