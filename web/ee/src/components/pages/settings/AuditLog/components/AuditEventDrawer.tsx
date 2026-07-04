/**
 * Audit Log — Event Detail Drawer
 *
 * Right-side drawer showing the full payload of a single event. Data is read
 * from the entity session cache (`eventByIdAtomFamily`) — the selected event
 * is always a row currently loaded in the table, so no fetch is needed.
 */

import type {ReactNode} from "react"

import {eventByIdAtomFamily} from "@agenta/entities/event"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Empty, EmptyDescription, EmptyHeader} from "@agenta/primitive-ui/components/empty"
import {dayjs} from "@agenta/shared/utils"
import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Copy} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {UserReference} from "@/oss/components/References/UserReference"

import {auditDrawerOpenAtom, selectedEventIdAtom} from "../state"

const DetailRow = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex border-0 border-b border-solid border-gray-100 last:border-b-0">
        <div className="w-[140px] shrink-0 bg-gray-50 px-3 py-2 text-xs text-gray-500">{label}</div>
        <div className="flex flex-1 items-center px-3 py-2 text-xs">{children}</div>
    </div>
)

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
                    <div className="overflow-hidden rounded-md border border-solid border-gray-100">
                        <DetailRow label="Event type">
                            <Badge variant="outline" className="font-mono text-xs">
                                {event.event_type}
                            </Badge>
                        </DetailRow>
                        <DetailRow label="Actor">
                            {actor ? (
                                <div className="flex items-center gap-2">
                                    <UserReference userId={actor} />
                                    {/* Keep the raw user-id copy affordance. */}
                                    <CopyTooltip copyText={actor} title="Copy user id">
                                        <Copy
                                            size={14}
                                            className="cursor-pointer text-gray-400 hover:text-gray-600"
                                        />
                                    </CopyTooltip>
                                </div>
                            ) : (
                                <span className="text-xs text-gray-400">—</span>
                            )}
                        </DetailRow>
                        <DetailRow label="Count">
                            <span className="text-xs tabular-nums">{count ?? "—"}</span>
                        </DetailRow>
                        <DetailRow label="Timestamp">
                            <span className="text-xs">
                                {dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss.SSS")}
                            </span>
                        </DetailRow>
                        <DetailRow label="Request ID">
                            <CopyTooltip copyText={event.request_id || ""} title="Copy request id">
                                <span className="cursor-pointer text-xs font-mono">
                                    {event.request_id}
                                </span>
                            </CopyTooltip>
                        </DetailRow>
                        <DetailRow label="Event ID">
                            <span className="text-xs font-mono">{event.event_id}</span>
                        </DetailRow>
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold">Attributes</span>
                        <pre className="m-0 max-h-[420px] overflow-auto rounded bg-gray-50 p-3 text-xs">
                            {JSON.stringify(event.attributes ?? {}, null, 2)}
                        </pre>
                    </div>
                </div>
            ) : (
                <Empty>
                    <EmptyHeader>
                        <EmptyDescription>No event selected</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )}
        </EnhancedDrawer>
    )
}

export default AuditEventDrawer
