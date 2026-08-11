import type {ReactNode} from "react"

import {triggerApplicationArtifactId, type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {CopyButton} from "@agenta/ui"
import {Badge, Button} from "@agenta/ui/ui"

export function deliveryStatusColor(type?: string | null): "green" | "red" | "blue" | "default" {
    switch ((type ?? "").toLowerCase()) {
        case "success":
        case "delivered":
        case "ok":
            return "green"
        case "error":
        case "failed":
        case "failure":
            return "red"
        case "pending":
        case "running":
            return "blue"
        default:
            return "default"
    }
}

function DetailRow({label, children}: {label: string; children: ReactNode}) {
    return (
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4 border-0 border-b border-solid border-colorBorderSecondary py-3 last:border-b-0">
            <span className="text-xs font-medium text-colorTextSecondary">{label}</span>
            <div className="min-w-0 text-xs text-colorText">{children}</div>
        </div>
    )
}

function Identifier({value}: {value: string}) {
    return (
        <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate font-mono">{value}</span>
            <CopyButton
                text={value}
                icon
                buttonText=""
                variant="ghost"
                size="icon-sm"
                successMessage="ID copied"
                stopPropagation
            />
        </span>
    )
}

function JsonValue({value}: {value: unknown}) {
    if (value == null) return <span className="text-colorTextTertiary">-</span>
    if (typeof value === "object" && Object.keys(value).length === 0)
        return <span className="text-colorTextTertiary">-</span>
    return (
        <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-colorFillQuaternary p-3 font-mono text-xs leading-snug">
            {JSON.stringify(value, null, 2)}
        </pre>
    )
}

function Timestamp({value}: {value?: string | null}) {
    return value ? <span>{new Date(value).toLocaleString()}</span> : <span>-</span>
}

export function DeliveryDetails({
    delivery,
    deliveryIdFallback,
    onOpenSession,
}: {
    delivery: TriggerDelivery
    deliveryIdFallback?: string
    onOpenSession?: (sessionId: string, applicationId: string) => void
}) {
    const deliveryId = delivery.id ?? deliveryIdFallback ?? "-"
    const status = delivery.status?.type ?? delivery.status?.code ?? "unknown"
    const sessionId = delivery.data?.session_id ?? null
    const applicationId = triggerApplicationArtifactId(delivery.data?.references)

    return (
        <div className="flex flex-col rounded border border-solid border-colorBorderSecondary bg-colorBgContainer px-4">
            <DetailRow label="Delivery ID">
                {deliveryId === "-" ? deliveryId : <Identifier value={deliveryId} />}
            </DetailRow>
            <DetailRow label="Event ID">
                <Identifier value={delivery.event_id} />
            </DetailRow>
            <DetailRow label="Status">
                <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={deliveryStatusColor(delivery.status?.type)}>{status}</Badge>
                    {delivery.status?.message ? (
                        <span className="text-colorTextSecondary">{delivery.status.message}</span>
                    ) : null}
                </span>
            </DetailRow>
            <DetailRow label="Inputs">
                <JsonValue value={delivery.data?.inputs} />
            </DetailRow>
            <DetailRow label="Result">
                <JsonValue value={delivery.data?.result} />
            </DetailRow>
            <DetailRow label="Error">
                {delivery.data?.error ? (
                    <span className="whitespace-pre-wrap break-words text-colorErrorText">
                        {delivery.data.error}
                    </span>
                ) : (
                    <span className="text-colorTextTertiary">-</span>
                )}
            </DetailRow>
            <DetailRow label="Created">
                <Timestamp value={delivery.created_at} />
            </DetailRow>
            <DetailRow label="Updated">
                <Timestamp value={delivery.updated_at} />
            </DetailRow>
            {sessionId ? (
                <DetailRow label="Session">
                    <span className="flex min-w-0 items-center justify-between gap-3">
                        <Identifier value={sessionId} />
                        {onOpenSession && applicationId ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenSession(sessionId, applicationId)}
                            >
                                Open session
                            </Button>
                        ) : null}
                    </span>
                </DetailRow>
            ) : null}
        </div>
    )
}
