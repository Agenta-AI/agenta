/**
 * Elicitation widget (interaction kinds M1) — renders a `render.kind: "elicitation"` client tool
 * as an inline form: the payload's flat JSON schema (MCP elicitation dialect) draws antd fields,
 * Accept validates and settles `{action: "accept", content}`, Decline/Dismiss settle their
 * structured actions, and every settled state replays as a single-line chip. All contract logic
 * (validation, envelopes, serialization, states) lives in @agenta/shared — this file is wiring.
 * Contract: docs/design/agent-chat-interaction-kinds/decisions.md
 */
import {useEffect, useMemo, useRef, useState} from "react"

import {
    SchemaForm,
    type SchemaFormHandle,
    type StepInfo,
    formatReviewValue,
} from "@agenta/entity-ui/gatewayTool"
import {useModifierKey} from "@agenta/shared/hooks"
import {
    type ElicitationResult,
    buildAcceptResult,
    buildCancelResult,
    buildDeclineResult,
    buildDegradationErrorText,
    buildFormFieldsFromSchema,
    deriveElicitationPartState,
    parseElicitationPayload,
    partitionElicitationDraft,
    serializeElicitationContent,
} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {ShortcutHint} from "@agenta/ui/rich-chat-input"
import {CaretRight, CheckCircle, Prohibit, Question, Warning, XCircle} from "@phosphor-icons/react"
import {Button, Form, Typography} from "antd"
import dayjs from "dayjs"

import {resolveToolDisplay} from "../../assets/toolDisplay"

import type {ClientToolHandlerProps} from "./types"

const {Text} = Typography

/** ElicitationResult → the settle channel's Record shape (interfaces carry no index signature). */
const toOutput = (result: ElicitationResult) => ({...result}) as Record<string, unknown>

/** In-progress field values survive a reload (localStorage draft keyed by the toolCallId). */
const draftKeyFor = (toolCallId: string) => `agenta:elicitation-draft:${toolCallId}`

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
        <Text type={tone === "warning" ? "warning" : "secondary"} className="!text-xs truncate">
            {children}
        </Text>
    </div>
)

/** Settled accept state — collapsible chip that reveals the submitted answers on click. */
const SubmittedAnswers = ({
    schema,
    content,
    message,
}: {
    schema: Record<string, unknown>
    content: Record<string, unknown>
    message: string
}) => {
    const [open, setOpen] = useState(false)
    const fields = useMemo(
        () => buildFormFieldsFromSchema(schema, "", {formats: true, openEnums: true}),
        [schema],
    )
    const answered = fields.filter((f) => content[f.name] !== undefined && content[f.name] !== "")
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
                <Text type="secondary" className="!text-xs truncate">
                    {message}
                </Text>
            </button>
            {answered.length > 0 ? (
                <HeightCollapse open={open}>
                    <div className="mt-1 flex min-w-0 flex-col gap-1 pl-[21px]">
                        {answered.map((f) => (
                            <div key={f.name} className="flex items-baseline justify-between gap-3">
                                <Text type="secondary" className="!text-[11px] shrink-0">
                                    {f.label}
                                </Text>
                                <Text className="!text-xs max-w-[70%] truncate text-right">
                                    {formatReviewValue(f, content[f.name])}
                                </Text>
                            </div>
                        ))}
                    </div>
                </HeightCollapse>
            ) : null}
        </div>
    )
}

const ElicitationWidget = ({meta, settle, degradedEarlierInTurn}: ClientToolHandlerProps) => {
    const [form] = Form.useForm()
    const formRef = useRef<SchemaFormHandle>(null)
    const modifierKey = useModifierKey()
    const [submitting, setSubmitting] = useState(false)
    const [stepInfo, setStepInfo] = useState<StepInfo | null>(null)
    // ⌘↵ only reaches this widget while focus lives inside it. Track that so the hint shows
    // exactly when the shortcut works — a stepper auto-focuses; other forms once the user engages.
    const [formFocused, setFormFocused] = useState(false)

    const parsed = useMemo(() => parseElicitationPayload(meta.input), [meta.input])

    // Accept stays disabled until every required question has an answer — a dominant, always-
    // enabled primary invites submitting unfinished forms. Defaults count, so a fully-prefilled
    // form is born ready (one-click accept). Decline/Dismiss stay always-available.
    const watchedValues = Form.useWatch([], form) as Record<string, unknown> | undefined
    const requiredNames = parsed.ok ? (parsed.payload.requestedSchema.required ?? []) : []
    const missingRequired = requiredNames.filter((name) => {
        const v = watchedValues?.[name]
        return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)
    })
    const requiredReady = missingRequired.length === 0

    // Degradation: invalid payload auto-settles errorText ONCE per turn; a repeat malformed
    // emission parks instead (visible notice, no auto-settle) — no settle→resume→re-emit loop.
    const parked = !parsed.ok && degradedEarlierInTurn === true
    const settledRef = useRef(false)
    useEffect(() => {
        if (parsed.ok || parked || settledRef.current || meta.settled) return
        settledRef.current = true
        settle({errorText: buildDegradationErrorText(parsed.reason)})
    }, [parsed, parked, meta.settled, settle])

    // Draft persistence: typed values live only in antd Form state, so a reload would lose them.
    const draftKey = draftKeyFor(meta.toolCallId)
    const clearDraft = () => {
        try {
            localStorage.removeItem(draftKey)
        } catch {
            // storage unavailable — drafts are best-effort
        }
    }
    const persistDraft = (values: Record<string, unknown>) => {
        try {
            localStorage.setItem(draftKey, JSON.stringify(values))
        } catch {
            // storage unavailable — drafts are best-effort
        }
    }
    const settleAndClear: typeof settle = (args: Parameters<typeof settle>[0]) => {
        clearDraft()
        settle(args as {output: Record<string, unknown>})
    }
    const restoredRef = useRef(false)
    useEffect(() => {
        if (restoredRef.current || !parsed.ok || parked || meta.settled) return
        restoredRef.current = true
        try {
            const raw = localStorage.getItem(draftKey)
            if (!raw) return
            const {plain, dates} = partitionElicitationDraft(
                parsed.payload,
                JSON.parse(raw) as Record<string, unknown>,
            )
            // DatePicker rejects strings — revive persisted ISO strings to dayjs.
            form.setFieldsValue({
                ...plain,
                ...Object.fromEntries(Object.entries(dates).map(([k, v]) => [k, dayjs(v)])),
            })
        } catch {
            // unreadable draft — fall back to schema defaults
        }
    }, [parsed, parked, meta.settled, draftKey, form])

    const partState = deriveElicitationPartState({
        state: meta.state,
        output: meta.output,
        errorText: (meta.part as {errorText?: string}).errorText,
    })

    // Settled replays: chip copy comes from the envelope (`humanFriendlyMessage`), never re-resolved.
    if (partState !== "pending") {
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
                <SubmittedAnswers
                    schema={parsed.payload.requestedSchema as unknown as Record<string, unknown>}
                    content={content}
                    message={message}
                />
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
        return (
            <Chip
                icon={<Warning size={13} weight="fill" className="shrink-0 text-colorWarning" />}
                tone="warning"
            >
                Couldn’t render this request{parsed.ok ? "" : ` — ${parsed.reason}`}.
            </Chip>
        )
    }

    if (parked)
        return (
            <Chip
                icon={<Warning size={13} weight="fill" className="shrink-0 text-colorWarning" />}
                tone="warning"
            >
                This request needs attention — it couldn’t be rendered (
                {parsed.ok ? "" : parsed.reason}).
            </Chip>
        )

    if (!parsed.ok) return null // degradation auto-settle in flight (effect above)

    const requiredCount = parsed.payload.requestedSchema.required?.length ?? 0
    const stepperHint = Boolean(parsed.payload.requestedSchema["x-ag-stepper"])

    const handleAccept = async () => {
        setSubmitting(true)
        try {
            const values = await form.validateFields()
            const content = serializeElicitationContent(parsed.payload, values)
            settleAndClear({
                output: toOutput(buildAcceptResult(content, "Provided the requested input.")),
            })
        } catch (err) {
            // antd surfaces inline field errors; in stepper mode, jump to the failing question.
            const first = (err as {errorFields?: {name: (string | number)[]}[]})?.errorFields?.[0]
            if (first?.name) formRef.current?.goToField?.(first.name)
        } finally {
            setSubmitting(false)
        }
    }

    const inStepper = stepInfo?.isStepper === true && stepInfo.isReview === false
    const handlePrimaryAction = () => {
        if (inStepper) {
            formRef.current?.next?.()
            return
        }
        if (requiredReady && !submitting) void handleAccept()
    }

    return (
        <div
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary p-3 my-1 max-w-2xl"
            onFocusCapture={() => setFormFocused(true)}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setFormFocused(false)
            }}
            onKeyDownCapture={(event) => {
                if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey) || event.repeat)
                    return
                event.preventDefault()
                event.stopPropagation()
                handlePrimaryAction()
            }}
        >
            <div className="flex items-start gap-2">
                <Question size={14} weight="fill" className="shrink-0 mt-0.5 text-colorPrimary" />
                <div className="flex min-w-0 flex-col">
                    <Text className="!text-xs">{parsed.payload.message}</Text>
                    {/* Requester attribution — muted subtext, never a banner (design D-spec). */}
                    <Text type="secondary" className="!text-[11px]">
                        Asked by {resolveToolDisplay(meta.toolName).label}
                        {requiredCount > 0
                            ? ` · Waiting on your input · ${requiredCount} required`
                            : " · Waiting on your input"}
                    </Text>
                </div>
            </div>

            <SchemaForm
                ref={formRef}
                schema={parsed.payload.requestedSchema as unknown as Record<string, unknown>}
                form={form}
                formats
                openEnums
                stepper={stepperHint}
                onValuesChange={persistDraft}
                onStepChange={setStepInfo}
            />

            {/* ⌘↵ is advertised whenever it works: in a stepper (auto-focused) or in any form the
                user has focused. Paging/pick hints are stepper-only. */}
            {stepInfo && (stepInfo.isStepper || formFocused) ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
                    {stepInfo.isStepper && stepInfo.canGoBack ? (
                        <ShortcutHint keys={`${modifierKey} ←`} label="back" />
                    ) : null}
                    {stepInfo.isStepper && stepInfo.canGoNext ? (
                        <ShortcutHint keys={`${modifierKey} →`} label="forward" />
                    ) : null}
                    {stepInfo.isStepper && stepInfo.pickable ? (
                        <ShortcutHint keys="1–9" label="pick" />
                    ) : null}
                    <ShortcutHint keys={`${modifierKey} ↵`} label={inStepper ? "next" : "accept"} />
                </div>
            ) : null}

            <div className="flex items-center gap-2">
                {inStepper ? (
                    <Button type="primary" onClick={handlePrimaryAction}>
                        Next
                    </Button>
                ) : (
                    <Button
                        type="primary"
                        loading={submitting}
                        disabled={!requiredReady}
                        title={
                            requiredReady
                                ? undefined
                                : `${missingRequired.length} required ${missingRequired.length === 1 ? "answer" : "answers"} to go`
                        }
                        onClick={handlePrimaryAction}
                    >
                        Accept
                    </Button>
                )}
                <Button
                    type="text"
                    onClick={() =>
                        settleAndClear({
                            output: toOutput(buildDeclineResult("Declined the request.")),
                        })
                    }
                >
                    Decline
                </Button>
                <Button
                    type="text"
                    className="ml-auto opacity-60"
                    onClick={() =>
                        settleAndClear({
                            output: toOutput(buildCancelResult("Dismissed the request.")),
                        })
                    }
                >
                    Dismiss
                </Button>
            </div>
        </div>
    )
}

export default ElicitationWidget
