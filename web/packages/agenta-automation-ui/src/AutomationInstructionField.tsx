import {useCallback, useEffect, useMemo, useRef} from "react"

import {
    eventFieldLabels,
    eventFieldsFromSchema,
    latestDeliveryEvent,
    parseMessageTemplate,
    remapMessageShape,
    remapMessageTemplate,
    renderMessagePreview,
    templateSelectors,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    type EventFieldCard,
} from "@agenta/entities/gatewayTrigger"
import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {workflowLatestRevisionQueryAtomFamily} from "@agenta/entities/workflow"
import {
    EventFieldCards,
    EventMessageComposer,
    MessageComposer,
} from "@agenta/entity-ui/gatewayTrigger"
import {Checkbox} from "@agenta/ui/ui"
import {Eye} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AutomationField} from "./AutomationField"
import type {Automation, AutomationKind} from "./automationModel"
import {useAutomationRuns} from "./useAutomationRuns"

/**
 * What the agent is told on every run — the shared `MessageComposer`, over `data.inputs_fields`.
 *
 * Controlled by the host, with no draft of its own: both screens that mount it already hold the
 * unsaved config, and a second copy here is how a Discard leaves the old text sitting in the box.
 * Typing costs nothing now — the host holds it in memory until Save.
 *
 * The composer maps the message onto whichever input the bound agent takes, read off the agent's
 * LATEST REVISION rather than off the artifact: only a revision carries `flags.is_chat` and the
 * input schema, so a screen that knows the agent only from a list would otherwise see neither and
 * write a chat agent's instruction under "message", which the runner never reads. The field does
 * not wait for the revision — it lets the reader type and migrates the key when the shape lands.
 *
 * An event automation gets the pill composer, the event's field cards, the include-event
 * checkbox and a preview of what the agent gets, filled from the newest recorded event.
 */
export const AutomationInstructionField = ({
    agentId,
    inputsFields,
    onCommit,
    kind,
    connectionId,
    eventKey,
    includeEvent,
    onChangeIncludeEvent,
    automation,
}: {
    agentId: string | null
    inputsFields: unknown
    onCommit: (next: Record<string, unknown>) => void
    kind: AutomationKind
    /** Event automations only — where the catalog event is looked up. */
    connectionId: string | null
    eventKey: string | null
    includeEvent: boolean
    onChangeIncludeEvent: (next: boolean) => void
    /** The saved automation whose deliveries fill the preview; null on the create screen. */
    automation: Automation | null
}) => {
    const isEvent = kind === "event"
    const inputsText = useMemo(() => JSON.stringify(inputsFields ?? {}, null, 2), [inputsFields])

    const latest = useAtomValue(workflowLatestRevisionQueryAtomFamily(agentId ?? ""))
    const revision = latest.data ?? null

    // Which input the message lands on. The stored shape wins inside the composer's own
    // getter/setter; this only decides where a message goes when there is nothing stored yet.
    // Same two checks the workflow molecule makes, against the revision we just resolved: the
    // flag first, then a `messages` property on the input schema for when the flag lags behind.
    const inputSchema = revision?.data?.schemas?.inputs as Record<string, unknown> | undefined
    const isChat = useMemo(() => {
        if (revision?.flags?.is_chat) return true
        const properties = inputSchema?.properties as Record<string, unknown> | undefined
        return Boolean(properties?.messages)
    }, [inputSchema, revision?.flags?.is_chat])

    const primaryKey = useMemo(() => {
        if (isChat) return "messages"
        const ports = extractInputPortsFromSchema(inputSchema ?? null)
        return ports.find((port) => port.type === "string")?.key ?? "message"
    }, [inputSchema, isChat])

    // The field is never locked. Before an agent is picked — or before its revision lands — the
    // message is typed under the completion key, and the migration below rewrites it into the
    // agent's real shape the moment that shape is known. A locked field was the earlier answer,
    // and it read as broken: nothing on the screen said WHY it would not take input.
    const resolving = Boolean(agentId) && !revision && latest.isPending

    // The revision can land after a message was typed, or an automation can have been saved under
    // the wrong key before this resolved at all. Either way the stored shape is migrated to the
    // one the agent takes, deleting the old key rather than leaving both.
    const shape = useMemo(() => ({isChat, primaryKey}), [isChat, primaryKey])
    const previousShape = useRef(shape)
    useEffect(() => {
        const previous = previousShape.current
        previousShape.current = shape
        if (resolving) return
        if (previous.isChat === shape.isChat && previous.primaryKey === shape.primaryKey) return
        const next = (isEvent ? remapMessageTemplate : remapMessageShape)(
            inputsText,
            previous,
            shape,
        )
        if (next === inputsText) return
        try {
            onCommit(JSON.parse(next) as Record<string, unknown>)
        } catch {
            // A mapping the composer cannot read is left exactly as it was.
        }
    }, [inputsText, isEvent, onCommit, resolving, shape])

    const onChange = useCallback(
        (next: string) => {
            try {
                const parsed: unknown = JSON.parse(next)
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return
                onCommit(parsed as Record<string, unknown>)
            } catch {
                // The composer only ever writes valid JSON; an unparseable value is not ours.
            }
        },
        [onCommit],
    )

    if (isEvent) {
        return (
            <EventInstruction
                inputsText={inputsText}
                onChange={onChange}
                isChat={isChat}
                primaryKey={primaryKey}
                connectionId={connectionId}
                eventKey={eventKey}
                includeEvent={includeEvent}
                onChangeIncludeEvent={onChangeIncludeEvent}
                automation={automation}
            />
        )
    }

    return (
        <AutomationField label="Instruction">
            <MessageComposer
                inputsText={inputsText}
                onChange={onChange}
                isChat={isChat}
                primaryKey={primaryKey}
            />
        </AutomationField>
    )
}

function EventInstruction({
    inputsText,
    onChange,
    isChat,
    primaryKey,
    connectionId,
    eventKey,
    includeEvent,
    onChangeIncludeEvent,
    automation,
}: {
    inputsText: string
    onChange: (next: string) => void
    isChat: boolean
    primaryKey: string
    connectionId: string | null
    eventKey: string | null
    includeEvent: boolean
    onChangeIncludeEvent: (next: boolean) => void
    automation: Automation | null
}) {
    // The catalog is keyed by integration, which the automation knows only through its connection.
    const {connections} = useTriggerConnectionsQuery()
    const integrationKey =
        connections.find((connection) => connection.id === connectionId)?.integration_key ?? ""
    const {event: catalogEvent} = useTriggerEvent(integrationKey, eventKey ?? "")
    const groups = useMemo(
        () => eventFieldsFromSchema(catalogEvent?.payload ?? null),
        [catalogEvent?.payload],
    )
    const labels = useMemo(() => eventFieldLabels(groups), [groups])

    const {runs} = useAutomationRuns(automation)
    const lastEvent = useMemo(() => latestDeliveryEvent(runs), [runs])

    const template = parseMessageTemplate(inputsText, isChat, primaryKey)
    const used = useMemo(() => new Set(templateSelectors(template ?? "")), [template])
    const preview =
        template === null ? null : renderMessagePreview(template, lastEvent, labels, includeEvent)

    const insertApi = useRef<{insert: (selector: string) => void} | null>(null)
    const onInsert = useCallback((card: EventFieldCard) => {
        insertApi.current?.insert(card.selector)
    }, [])

    return (
        <AutomationField label="Instruction">
            <div className="flex flex-col gap-4">
                <EventMessageComposer
                    inputsText={inputsText}
                    onChange={onChange}
                    isChat={isChat}
                    primaryKey={primaryKey}
                    labels={labels}
                    insertApi={insertApi}
                />
                <EventFieldCards groups={groups} used={used} onInsert={onInsert} />
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                    <Checkbox
                        checked={includeEvent}
                        onCheckedChange={(checked) => onChangeIncludeEvent(checked === true)}
                    />
                    Also attach the full event, so the agent can use any detail
                </label>
                {preview === null ? null : (
                    <div className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-4">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                            <Eye aria-hidden className="size-4" />
                            What the agent gets
                            {lastEvent ? (
                                <span className="font-normal text-muted-foreground">
                                    from the last event
                                </span>
                            ) : null}
                        </span>
                        <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 font-[inherit] text-[13px] text-foreground">
                            {preview}
                        </pre>
                    </div>
                )}
            </div>
        </AutomationField>
    )
}
