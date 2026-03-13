import {useEffect, useMemo, useState} from "react"

import {bgColors, borderColors, cn, textColors} from "@agenta/ui"
import {Empty, Skeleton} from "antd"
import {useAtomValue} from "jotai"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {WebhookDelivery} from "@/oss/services/automations/types"
import {automationDeliveriesAtomFamily} from "@/oss/state/automations/atoms"

const formatTimestamp = (value?: string) => {
    if (!value) return "-"
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleString()
}

const getStatusCode = (delivery: WebhookDelivery) => {
    return delivery.data?.response?.status_code || delivery.status.code || "-"
}

const isDeliverySuccess = (delivery: WebhookDelivery) => {
    return delivery.status.message === "success"
}

/** Headers whose values must never be displayed in the UI. */
const SENSITIVE_HEADERS = new Set(["authorization", "x-agenta-signature"])
const REDACTED_VALUE = "[REDACTED]"

/**
 * Return a deep copy of a delivery with sensitive header values replaced.
 * Defence-in-depth: the backend already redacts before persisting, but older
 * delivery records (created before the fix) may still contain raw secrets.
 */
const sanitizeDelivery = (delivery: WebhookDelivery): WebhookDelivery => {
    const headers = delivery.data?.headers
    if (!headers) return delivery

    const needsRedaction = Object.keys(headers).some((k) => SENSITIVE_HEADERS.has(k.toLowerCase()))
    if (!needsRedaction) return delivery

    const sanitized: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
        sanitized[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? REDACTED_VALUE : v
    }

    return {
        ...delivery,
        data: {
            ...delivery.data,
            headers: sanitized,
        },
    }
}

const DeliveryListItem = ({
    delivery,
    isSelected,
    onClick,
}: {
    delivery: WebhookDelivery
    isSelected: boolean
    onClick: () => void
}) => {
    const success = isDeliverySuccess(delivery)
    const statusCode = getStatusCode(delivery)

    return (
        <div
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            className={cn(
                "flex cursor-pointer flex-col gap-1 border-l-2 px-3 py-2.5 transition-colors",
                borderColors.divider,
                "border-b",
                isSelected
                    ? "border-l-primary bg-zinc-1"
                    : cn("border-l-transparent", bgColors.hoverSubtle),
            )}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onClick()
                }
            }}
        >
            <div className="flex items-center gap-1.5">
                <span
                    className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        success ? "bg-green-6" : "bg-red-6",
                    )}
                />
                <span
                    className={cn("text-xs font-medium", success ? "text-green-7" : "text-red-6")}
                >
                    {success ? "Success" : "Failed"}
                </span>
                <span className={cn("text-xs", textColors.quaternary)}>·</span>
                <span className={cn("text-xs", textColors.tertiary)}>{statusCode}</span>
            </div>
            <span className={cn("truncate text-sm", textColors.primary)}>
                {delivery.data?.event_type || "Webhook Test"}
            </span>
            <span className={cn("text-xs", textColors.tertiary)}>
                {formatTimestamp(delivery.created_at)}
            </span>
        </div>
    )
}

export const AutomationLogsTab = ({subscriptionId}: {subscriptionId: string}) => {
    const {data: deliveries, isPending} = useAtomValue(
        automationDeliveriesAtomFamily(subscriptionId),
    )
    const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null)

    useEffect(() => {
        if (!deliveries?.length) {
            setSelectedDeliveryId(null)
            return
        }

        if (
            !selectedDeliveryId ||
            !deliveries.some((delivery) => delivery.id === selectedDeliveryId)
        ) {
            setSelectedDeliveryId(deliveries[0].id)
        }
    }, [deliveries, selectedDeliveryId])

    const selectedDelivery = useMemo(
        () => deliveries?.find((delivery) => delivery.id === selectedDeliveryId) ?? null,
        [deliveries, selectedDeliveryId],
    )

    const deliveryJson = useMemo(() => {
        if (!selectedDelivery) return ""
        return JSON.stringify(sanitizeDelivery(selectedDelivery), null, 2)
    }, [selectedDelivery])

    if (isPending) {
        return <Skeleton active paragraph={{rows: 10}} />
    }

    if (!deliveries?.length) {
        return (
            <div
                className={cn(
                    "flex min-h-[320px] items-center justify-center rounded border border-dashed",
                    borderColors.default,
                )}
            >
                <Empty description="No delivery logs yet" />
            </div>
        )
    }

    return (
        <div
            className={cn(
                "flex min-h-[420px] overflow-hidden rounded border",
                borderColors.secondary,
            )}
        >
            {/* Delivery list */}
            <div
                className={cn(
                    "w-[220px] shrink-0 overflow-y-auto border-r",
                    borderColors.secondary,
                )}
            >
                {deliveries.map((delivery) => (
                    <DeliveryListItem
                        key={delivery.id}
                        delivery={delivery}
                        isSelected={delivery.id === selectedDeliveryId}
                        onClick={() => setSelectedDeliveryId(delivery.id)}
                    />
                ))}
            </div>

            {/* Detail: raw JSON */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {selectedDelivery ? (
                    <div className="h-full overflow-auto p-3">
                        <SimpleSharedEditor
                            headerName="Delivery JSON"
                            value={deliveryJson}
                            disabled
                            isJSON
                            defaultMinimized={false}
                            isMinimizeVisible={false}
                            isFormatVisible={false}
                        />
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <Empty description="Select a delivery to inspect" />
                    </div>
                )}
            </div>
        </div>
    )
}

export default AutomationLogsTab
