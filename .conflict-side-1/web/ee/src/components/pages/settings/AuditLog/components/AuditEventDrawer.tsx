/**
 * Audit Log — Event Detail Drawer
 *
 * Right-side drawer showing the full payload of a single event. Data is read
 * from the entity session cache (`eventByIdAtomFamily`) — the selected event
 * is always a row currently loaded in the table, so no fetch is needed.
 */

import {eventByIdAtomFamily} from "@agenta/entities/event"
import {dayjs} from "@agenta/shared/utils"
import {Descriptions, Empty, Tag, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {UserReference} from "@/oss/components/References/UserReference"

import {auditDrawerOpenAtom, selectedEventIdAtom} from "../state"

const AuditEventDrawer = () => {
    const [open, setOpen] = useAtom(auditDrawerOpenAtom)
    const selectedId = useAtomValue(selectedEventIdAtom)
    const event = useAtomValue(eventByIdAtomFamily(selectedId ?? ""))

    // Actor/count live in `attributes` — the top-level `request_type` /
    // `status_code` / `created_by_id` fields are left unset by the backend.
    const actor = typeof event?.attributes?.user_id === "string" ? event.attributes.user_id : null
    const count = typeof event?.attributes?.count === "number" ? event.attributes.count : null

    const close = () => setOpen(false)

    return (
        <EnhancedDrawer
            open={open}
            onClose={close}
            width={560}
            title="Event details"
            closeOnLayoutClick={false}
        >
            {event ? (
                <div className="flex flex-col gap-4">
                    <Descriptions
                        column={1}
                        size="small"
                        bordered
                        items={[
                            {
                                key: "event_type",
                                label: "Event type",
                                children: (
                                    <Tag className="m-0 font-mono text-xs" bordered>
                                        {event.event_type}
                                    </Tag>
                                ),
                            },
                            {
                                key: "actor",
                                label: "Actor",
                                children: actor ? (
                                    <div className="flex items-center gap-2">
                                        <UserReference userId={actor} />
                                        {/* Keep the raw user-id copy affordance. */}
                                        <Typography.Text copyable={{text: actor}} />
                                    </div>
                                ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                ),
                            },
                            {
                                key: "count",
                                label: "Count",
                                children: (
                                    <span className="text-xs tabular-nums">{count ?? "—"}</span>
                                ),
                            },
                            {
                                key: "timestamp",
                                label: "Timestamp",
                                children: (
                                    <span className="text-xs">
                                        {dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss.SSS")}
                                    </span>
                                ),
                            },
                            {
                                key: "request_id",
                                label: "Request ID",
                                children: (
                                    <Typography.Text
                                        className="text-xs font-mono"
                                        copyable={{text: event.request_id}}
                                    >
                                        {event.request_id}
                                    </Typography.Text>
                                ),
                            },
                            {
                                key: "event_id",
                                label: "Event ID",
                                children: (
                                    <Typography.Text className="text-xs font-mono">
                                        {event.event_id}
                                    </Typography.Text>
                                ),
                            },
                        ]}
                    />

                    <div className="flex flex-col gap-1">
                        <Typography.Text strong className="text-xs">
                            Attributes
                        </Typography.Text>
                        <pre className="m-0 max-h-[420px] overflow-auto rounded bg-gray-50 p-3 text-xs">
                            {JSON.stringify(event.attributes ?? {}, null, 2)}
                        </pre>
                    </div>
                </div>
            ) : (
                <Empty description="No event selected" />
            )}
        </EnhancedDrawer>
    )
}

export default AuditEventDrawer
