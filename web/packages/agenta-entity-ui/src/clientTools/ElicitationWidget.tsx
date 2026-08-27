/**
 * The transcript row for a `render.kind: "elicitation"` client tool.
 *
 * PASSIVE. The docked card above the composer owns the questions, the answers and every settle
 * (@agenta/chat `ElicitationDock`); this row only marks that the agent asked, and replays what was
 * answered. It settles NOTHING — not even a degradation. That used to live here and fired on any
 * mount whose input failed to parse, including a still-streaming one, which killed requests that
 * were about to work; the dock now owns it behind an "input has actually arrived" guard.
 *
 * Deliberately free of antd, dayjs, SchemaForm and ShortcutHint. The old inline card pulled all four
 * in, and its two whole-tree `Form.useWatch([])` subscriptions re-rendered the transcript on every
 * keystroke — a named cause of the jitter the docked card exists to remove. Keep this file at plain
 * React plus @agenta/ui.
 *
 * Contract: docs/design/agent-chat-interaction-kinds/decisions.md
 */
import {useMemo, useState} from "react"

import {
    type ClientToolWidgetProps as ClientToolHandlerProps,
    isInteractionEndedOutput,
} from "@agenta/shared/clientTools"
import {
    buildElicitationSteps,
    deriveElicitationPartState,
    formatStepValue,
    parseElicitationPayload,
    parseSecretRefusal,
} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {CaretRight, CheckCircle, Prohibit, Question, Warning, XCircle} from "@phosphor-icons/react"

/** Settled/parked single-line chip — one chrome for every terminal state (design: settled chip). */
const Chip = ({
    icon,
    children,
    tone = "secondary",
}: {
    icon: React.ReactNode
    children: React.ReactNode
    tone?: "secondary" | "warning"
}) => (
    <div className="flex min-w-0 items-center gap-2 py-1">
        {icon}
        <span
            className={`truncate text-xs ${
                tone === "warning" ? "text-colorWarning" : "text-colorTextSecondary"
            }`}
        >
            {children}
        </span>
    </div>
)

/** Settled accept state — collapsible chip that reveals the submitted answers on click. */
const SubmittedAnswers = ({
    payload,
    content,
    message,
}: {
    payload: Parameters<typeof buildElicitationSteps>[0]
    content: Record<string, unknown>
    message: string
}) => {
    const [open, setOpen] = useState(false)
    const steps = useMemo(() => buildElicitationSteps(payload).steps, [payload])
    const answered = steps.filter((step) => content[step.name] !== undefined)
    return (
        <div className="flex min-w-0 flex-col py-1">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
            >
                <CaretRight
                    size={11}
                    weight="bold"
                    className={`shrink-0 text-colorTextTertiary transition-transform ${open ? "rotate-90" : ""}`}
                />
                <CheckCircle size={13} weight="fill" className="shrink-0 text-colorSuccess" />
                <span className="truncate text-xs text-colorTextSecondary">{message}</span>
            </button>
            {answered.length > 0 ? (
                <HeightCollapse open={open}>
                    <div className="mt-1 flex min-w-0 flex-col gap-1 pl-[21px]">
                        {answered.map((step) => (
                            <div
                                key={step.name}
                                className="flex items-baseline justify-between gap-3"
                            >
                                <span className="shrink-0 text-xs text-colorTextSecondary">
                                    {step.label}
                                </span>
                                <span className="max-w-[70%] truncate text-right text-xs text-colorText">
                                    {formatStepValue(step, content[step.name])}
                                </span>
                            </div>
                        ))}
                    </div>
                </HeightCollapse>
            ) : null}
        </div>
    )
}

const ElicitationWidget = ({meta, degradedEarlierInTurn}: ClientToolHandlerProps) => {
    const parsed = useMemo(() => parseElicitationPayload(meta.input), [meta.input])

    const partState = deriveElicitationPartState({
        state: meta.state,
        output: meta.output,
        errorText: (meta.part as {errorText?: string}).errorText,
    })

    // Settled replays: chip copy comes from the envelope (`humanFriendlyMessage`), never re-resolved.
    if (partState !== "pending") {
        // An abandoned session's unsettled client tools are stamped with this on replay.
        if (isInteractionEndedOutput(meta.output)) {
            return (
                <Chip icon={<Question size={13} className="shrink-0 text-colorTextTertiary" />}>
                    Request ended
                </Chip>
            )
        }
        const envelopeMessage =
            meta.output &&
            typeof (meta.output as {humanFriendlyMessage?: unknown}).humanFriendlyMessage ===
                "string"
                ? ((meta.output as {humanFriendlyMessage: string}).humanFriendlyMessage as string)
                : undefined
        if (partState === "submitted") {
            const content =
                meta.output && typeof meta.output === "object"
                    ? ((meta.output as {content?: Record<string, unknown>}).content ?? {})
                    : {}
            const message = envelopeMessage ?? "Provided the requested input."
            return parsed.ok && Object.keys(content).length > 0 ? (
                <SubmittedAnswers payload={parsed.payload} content={content} message={message} />
            ) : (
                <Chip
                    icon={
                        <CheckCircle
                            size={13}
                            weight="fill"
                            className="shrink-0 text-colorSuccess"
                        />
                    }
                >
                    {message}
                </Chip>
            )
        }
        if (partState === "declined")
            return (
                <Chip
                    icon={
                        <XCircle
                            size={13}
                            weight="fill"
                            className="shrink-0 text-colorTextTertiary"
                        />
                    }
                >
                    {envelopeMessage ?? "Declined the request."}
                </Chip>
            )
        if (partState === "cancelled")
            return (
                <Chip icon={<Prohibit size={13} className="shrink-0 text-colorTextTertiary" />}>
                    {envelopeMessage ?? "Dismissed the request."}
                </Chip>
            )
        return <DegradedChip reason={parsed.ok ? undefined : parsed.reason} />
    }

    // Pending but unrenderable: either the payload is still arriving, or the dock's degradation
    // settle is in flight. Hold the row rather than returning null — a zero-height frame here shoved
    // the transcript, and this is the branch the retry cap parks on.
    if (!parsed.ok) {
        if (degradedEarlierInTurn) return <DegradedChip reason={parsed.reason} />
        return (
            <Chip icon={<Question size={13} className="shrink-0 text-colorTextTertiary" />}>
                The agent is preparing a request…
            </Chip>
        )
    }

    // The tool's `message` is the agent's own framing and the only context it wrote, so it belongs
    // here in the transcript rather than in the dock. No jump affordance: the dock is pinned above
    // the composer and already on screen whenever it holds this call.
    const count = buildElicitationSteps(parsed.payload).steps.length
    return (
        <div className="flex min-w-0 items-start gap-2 py-1">
            <Question size={13} className="mt-0.5 shrink-0 text-colorTextTertiary" />
            <span className="line-clamp-2 min-w-0 text-xs text-colorTextSecondary">
                {parsed.payload.message}
                <span className="text-colorTextTertiary">
                    {" "}
                    · {count} {count === 1 ? "question" : "questions"} · answering below
                </span>
            </span>
        </div>
    )
}

/** A payload the dialect refused. The secret-shaped case gets the reason spelled out, because the
 * dock's own refusal panel disappears with the dock and this row is the durable explanation. */
const DegradedChip = ({reason}: {reason?: string}) => {
    const secret = reason ? parseSecretRefusal(reason) : null
    return (
        <Chip
            icon={<Warning size={13} weight="fill" className="shrink-0 text-colorWarning" />}
            tone="warning"
        >
            {secret
                ? `This request asked for an ${secret.property} — forms never carry secrets. Connect the credential instead.`
                : `Couldn’t render this request${reason ? ` — ${reason}` : ""}.`}
        </Chip>
    )
}

export default ElicitationWidget
