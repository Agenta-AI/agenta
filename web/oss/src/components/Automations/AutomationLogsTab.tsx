import {useEffect, useMemo, useState} from "react"

import {Empty, Skeleton, Tabs, Tag, Typography, type TabsProps} from "antd"
import {useAtomValue} from "jotai"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {WebhookDelivery} from "@/oss/services/automations/types"
import {automationDeliveriesAtomFamily} from "@/oss/state/automations/atoms"

const formatTimestamp = (value?: string) => {
    if (!value) {
        return "-"
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return value
    }

    return parsed.toLocaleString()
}

const getStatusColor = (delivery: WebhookDelivery) => {
    return delivery.status.message === "success" ? "success" : "error"
}

const getStatusCode = (delivery: WebhookDelivery) => {
    return delivery.data?.response?.status_code || delivery.status.code || "-"
}

const renderJson = (value: unknown) => {
    if (value === undefined || value === null) {
        return ""
    }

    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

const OverviewField = ({label, value}: {label: string; value?: string | number | null}) => {
    return (
        <div className="rounded border border-[var(--color-border)] bg-white p-3">
            <Typography.Text type="secondary" className="block text-xs uppercase tracking-wide">
                {label}
            </Typography.Text>
            <Typography.Text className="mt-1 block break-words font-medium">
                {value || "-"}
            </Typography.Text>
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

    const detailItems = useMemo<TabsProps["items"]>(() => {
        if (!selectedDelivery) {
            return []
        }

        return [
            {
                key: "overview",
                label: "Overview",
                children: (
                    <div className="flex flex-col gap-4 p-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <OverviewField
                                label="Sent At"
                                value={formatTimestamp(selectedDelivery.created_at)}
                            />
                            <OverviewField
                                label="Event"
                                value={selectedDelivery.data?.event_type || "-"}
                            />
                            <OverviewField
                                label="Status Code"
                                value={getStatusCode(selectedDelivery)}
                            />
                            <OverviewField
                                label="Target URL"
                                value={selectedDelivery.data?.url || "-"}
                            />
                        </div>

                        <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-2">
                            <SimpleSharedEditor
                                headerName="Request Headers"
                                value={renderJson(selectedDelivery.data?.headers ?? {})}
                                disabled
                                isJSON
                                defaultMinimized={false}
                            />
                            <SimpleSharedEditor
                                headerName="Request Payload"
                                value={renderJson(selectedDelivery.data?.payload ?? {})}
                                disabled
                                isJSON
                                defaultMinimized={false}
                            />
                        </div>

                        <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-2">
                            <SimpleSharedEditor
                                headerName="Response Body"
                                value={renderJson(selectedDelivery.data?.response?.body ?? "")}
                                disabled
                                defaultMinimized={false}
                            />
                            <SimpleSharedEditor
                                headerName="Error"
                                value={renderJson(selectedDelivery.data?.error ?? "")}
                                disabled
                                defaultMinimized={false}
                            />
                        </div>
                    </div>
                ),
            },
            {
                key: "json",
                label: "JSON",
                children: (
                    <div className="p-4">
                        <SimpleSharedEditor
                            headerName="Delivery JSON"
                            value={JSON.stringify(selectedDelivery, null, 2)}
                            disabled
                            isJSON
                            defaultMinimized={false}
                        />
                    </div>
                ),
            },
        ]
    }, [selectedDelivery])

    if (isPending) {
        return <Skeleton active paragraph={{rows: 10}} />
    }

    if (!deliveries?.length) {
        return (
            <div className="flex min-h-[320px] items-center justify-center rounded border border-dashed border-[var(--color-border)] bg-white">
                <Empty description="No delivery logs yet" />
            </div>
        )
    }

    return (
        <div className="flex min-h-[420px] flex-col gap-4 lg:flex-row">
            <div className="overflow-hidden rounded border border-[var(--color-border)] bg-white lg:w-[260px] lg:shrink-0">
                <div className="border-b border-[var(--color-border)] px-4 py-3">
                    <Typography.Text className="font-medium">Recent Deliveries</Typography.Text>
                </div>

                <div className="max-h-[520px] overflow-auto">
                    {deliveries.map((delivery) => {
                        const isSelected = delivery.id === selectedDeliveryId

                        return (
                            <button
                                key={delivery.id}
                                type="button"
                                aria-pressed={isSelected}
                                className={`flex w-full flex-col gap-2 border-0 border-b border-solid border-[var(--color-border)] px-4 py-3 text-left transition-colors ${
                                    isSelected
                                        ? "bg-[var(--color-bg-code)]"
                                        : "bg-white hover:bg-[var(--color-bg-subtle)]"
                                }`}
                                onClick={() => setSelectedDeliveryId(delivery.id)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <Tag color={getStatusColor(delivery)} className="!mr-0">
                                        {delivery.status.message === "success"
                                            ? "Success"
                                            : "Failed"}
                                    </Tag>
                                    <Typography.Text type="secondary" className="text-xs">
                                        {getStatusCode(delivery)}
                                    </Typography.Text>
                                </div>
                                <Typography.Text className="text-sm font-medium">
                                    {delivery.data?.event_type || "Webhook Test"}
                                </Typography.Text>
                                <Typography.Text type="secondary" className="text-xs">
                                    {formatTimestamp(delivery.created_at)}
                                </Typography.Text>
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded border border-[var(--color-border)] bg-white [&_.ant-tabs]:h-full [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:h-full [&_.ant-tabs-tabpane]:h-full">
                {selectedDelivery ? (
                    <Tabs destroyOnHidden items={detailItems} className="h-full" />
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <Empty description="Select a delivery to inspect it" />
                    </div>
                )}
            </div>
        </div>
    )
}

export default AutomationLogsTab
