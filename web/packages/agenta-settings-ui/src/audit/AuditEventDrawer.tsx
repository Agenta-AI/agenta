/** One event's full payload, read from the table's own cache rather than refetched. */

import type {ReactNode} from "react"

import {eventByIdAtomFamily} from "@agenta/entities/event"
import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {dayjs} from "@agenta/shared/utils"
import {CopyButton, Tag} from "@agenta/ui/components/presentational"
import {EmptyState, Sheet, SheetContent, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

/** One `label: value` pair. antd's `Descriptions` has no @agenta/ui equivalent. */
const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex items-start gap-3 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2 last:border-b-0">
        <span className="w-[110px] shrink-0 text-xs text-colorTextSecondary">{label}</span>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-colorText">
            {children}
        </div>
    </div>
)

const Dash = () => <span className="text-xs text-colorTextTertiary">—</span>

export interface AuditEventDrawerProps {
    eventId: string | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

export const AuditEventDrawer = ({eventId, open, onOpenChange}: AuditEventDrawerProps) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId ?? ""))

    // Actor/count live in `attributes`; the top-level columns are left unset by the backend.
    const actor = typeof event?.attributes?.user_id === "string" ? event.attributes.user_id : null
    const count = typeof event?.attributes?.count === "number" ? event.attributes.count : null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            {/* Width inline, like EnhancedDrawer: `cn` does not merge, so a class would race
                the side variant's own `w-`, and `maxWidth` keeps it inside a phone viewport. */}
            <SheetContent style={{width: 560, maxWidth: "100%"}}>
                <SheetHeader>
                    <SheetTitle>Event details</SheetTitle>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto p-6">
                    {event ? (
                        <div className="flex flex-col gap-4">
                            <div className="rounded-lg border border-solid border-colorBorderSecondary">
                                <Row label="Event type">
                                    <Tag className="m-0 font-mono text-xs">{event.event_type}</Tag>
                                </Row>
                                <Row label="Actor">
                                    {actor ? (
                                        <>
                                            <UserAuthorLabel
                                                userId={actor}
                                                showAvatar
                                                showYouLabel
                                                fallback={actor}
                                            />
                                            {/* Keep the raw user-id copy affordance. */}
                                            <CopyButton
                                                text={actor}
                                                buttonText={null}
                                                icon
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Copy user id"
                                            />
                                        </>
                                    ) : (
                                        <Dash />
                                    )}
                                </Row>
                                <Row label="Count">
                                    <span className="tabular-nums">{count ?? "—"}</span>
                                </Row>
                                <Row label="Timestamp">
                                    {dayjs(event.timestamp).format("YYYY-MM-DD HH:mm:ss.SSS")}
                                </Row>
                                <Row label="Request ID">
                                    <span className="truncate font-mono">{event.request_id}</span>
                                    <CopyButton
                                        text={event.request_id ?? ""}
                                        buttonText={null}
                                        icon
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Copy request id"
                                    />
                                </Row>
                                <Row label="Event ID">
                                    <span className="truncate font-mono">{event.event_id}</span>
                                    <CopyButton
                                        text={event.event_id ?? ""}
                                        buttonText={null}
                                        icon
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Copy event id"
                                    />
                                </Row>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-colorText">
                                    Attributes
                                </span>
                                <pre className="m-0 max-h-[420px] overflow-auto rounded bg-colorFillQuaternary p-3 text-xs">
                                    {JSON.stringify(event.attributes ?? {}, null, 2)}
                                </pre>
                            </div>
                        </div>
                    ) : (
                        <EmptyState image="simple" description="No event selected" />
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}

export default AuditEventDrawer
