/**
 * Elicitation widget (interaction kinds M1) — renders a `render.kind: "elicitation"` client tool
 * as an inline form: the payload's flat JSON schema (MCP elicitation dialect) draws antd fields,
 * Accept validates and settles `{action: "accept", content}`, Decline/Dismiss settle their
 * structured actions, and every settled state replays as a single-line chip. All contract logic
 * (validation, envelopes, serialization, states) lives in @agenta/shared — this file is wiring.
 * Contract: docs/design/agent-chat-interaction-kinds/decisions.md
 */
import {useEffect, useMemo, useRef, useState} from "react"

import {SchemaForm, type SchemaFormHandle} from "@agenta/entity-ui/gatewayTool"
import {
    type ElicitationResult,
    buildAcceptResult,
    buildCancelResult,
    buildDeclineResult,
    buildDegradationErrorText,
    deriveElicitationPartState,
    parseElicitationPayload,
    partitionElicitationDraft,
    serializeElicitationContent,
} from "@agenta/shared/utils"
import {CheckCircle, Prohibit, Question, Warning, XCircle} from "@phosphor-icons/react"
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

const ElicitationWidget = ({meta, settle, degradedEarlierInTurn}: ClientToolHandlerProps) => {
    const [form] = Form.useForm()
    const formRef = useRef<SchemaFormHandle>(null)
    const [submitting, setSubmitting] = useState(false)

    const parsed = useMemo(() => parseElicitationPayload(meta.input), [meta.input])

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
        if (partState === "submitted")
            return (
                <Chip
                    icon={
                        <CheckCircle
                            size={13}
                            weight="fill"
                            className="shrink-0 text-colorSuccess"
                        />
                    }
                >
                    {envelopeMessage ?? "Provided the requested input."}
                </Chip>
            )
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

    return (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary p-3 my-1 max-w-[520px]">
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
            />

            <div className="flex items-center gap-2">
                <Button type="primary" loading={submitting} onClick={handleAccept}>
                    Accept
                </Button>
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
