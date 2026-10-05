/**
 * Audit Log — Event Detail Drawer
 *
 * Right-side sheet showing the full payload of a single event. Data is read
 * from the entity session cache (`eventByIdAtomFamily`) — the selected event
 * is always a row currently loaded in the table, so no fetch is needed.
 */

import {useMemo, type ReactNode} from "react"

import {eventByIdAtomFamily} from "@agenta/entities/event"
import type {WorkspaceMember} from "@agenta/entities/organization"
import {dayjs} from "@agenta/shared/utils"
import {CopyButton} from "@agenta/ui/components/presentational"
import {
    EmptyState,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {ActorCell} from "./AuditEventCells"
import {eventTypeLabel} from "./eventTypeLabels"

const Section = ({
    title,
    action,
    children,
}: {
    title: string
    action?: ReactNode
    children: ReactNode
}) => (
    <section className="flex flex-col gap-2">
        <div className="flex min-h-6 items-center justify-between">
            <h3 className="m-0 text-[13px] font-medium text-muted-foreground">{title}</h3>
            {action}
        </div>
        {children}
    </section>
)

/** One `label: value` pair in a framed list. */
const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground">
            {children}
        </div>
    </div>
)

const List = ({children}: {children: ReactNode}) => (
    <div className="flex flex-col divide-y divide-solid divide-border overflow-hidden rounded-[10px] border border-solid border-border">
        {children}
    </div>
)

const Copy = ({text, label}: {text: string; label: string}) => (
    <CopyButton
        text={text}
        buttonText={null}
        icon
        variant="ghost"
        size="icon"
        aria-label={label}
        className="ml-auto shrink-0"
    />
)

const Mono = ({children}: {children: ReactNode}) => (
    <span className="min-w-0 break-all font-mono text-[12.5px]">{children}</span>
)

type Reference = Record<string, {id?: string; slug?: string; version?: string | number}>

/** `references` is a list of `{entity: {id, slug, version}}`; flattened to one line each. */
const readReferences = (value: unknown) =>
    (Array.isArray(value) ? (value as Reference[]) : []).flatMap((reference) =>
        Object.entries(reference ?? {}).map(([entity, ref]) => ({
            entity: entity.replace(/_/g, " "),
            label: ref?.slug ?? ref?.id ?? "—",
            version: ref?.version,
            id: ref?.id,
        })),
    )

export interface AuditEventDrawerProps {
    eventId: string | null
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The roster that names the event's user, as in the table. */
    members?: WorkspaceMember[]
    currentUserId?: string | null
}

export const AuditEventDrawer = ({
    eventId,
    open,
    onOpenChange,
    members,
    currentUserId,
}: AuditEventDrawerProps) => {
    const event = useAtomValue(eventByIdAtomFamily(eventId ?? ""))
    const names = useMemo(
        () =>
            new Map(
                (members ?? [])
                    .filter((member) => member.user?.id)
                    .map((member) => [
                        member.user.id,
                        member.user.username || member.user.email || member.user.id,
                    ]),
            ),
        [members],
    )

    // Actor/count live in `attributes`; the top-level request fields are left unset by the backend.
    const actor = typeof event?.attributes?.user_id === "string" ? event.attributes.user_id : null
    const count = typeof event?.attributes?.count === "number" ? event.attributes.count : null
    const references = readReferences(event?.attributes?.references)
    const json = JSON.stringify(event?.attributes ?? {}, null, 2)
    const at = event ? dayjs(event.timestamp) : null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-[560px]">
                <SheetHeader>
                    <SheetTitle className="truncate">
                        {event ? eventTypeLabel(event.event_type) : "Event details"}
                    </SheetTitle>
                    {event && at ? (
                        <SheetDescription title={at.format("YYYY-MM-DD HH:mm:ss.SSS")}>
                            <span className="font-mono">{event.event_type}</span> ·{" "}
                            {at.format("MMM D, YYYY · HH:mm:ss")} · {at.fromNow()}
                        </SheetDescription>
                    ) : null}
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                    {event ? (
                        <div className="flex flex-col gap-6">
                            <Section title="Summary">
                                <List>
                                    <Row label="Actor">
                                        {actor ? (
                                            <>
                                                <ActorCell
                                                    eventId={eventId ?? ""}
                                                    names={names}
                                                    currentUserId={currentUserId}
                                                />
                                                <Copy text={actor} label="Copy user ID" />
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </Row>
                                    <Row label="Count">
                                        <span className="tabular-nums">{count ?? "—"}</span>
                                    </Row>
                                </List>
                            </Section>

                            {references.length ? (
                                <Section title="Affected">
                                    <List>
                                        {references.map((reference, index) => (
                                            <Row
                                                key={`${reference.entity}-${index}`}
                                                label={
                                                    reference.entity.charAt(0).toUpperCase() +
                                                    reference.entity.slice(1)
                                                }
                                            >
                                                <Mono>{reference.label}</Mono>
                                                {reference.version != null ? (
                                                    <span className="shrink-0 text-muted-foreground">
                                                        v{reference.version}
                                                    </span>
                                                ) : null}
                                                {reference.id ? (
                                                    <Copy
                                                        text={reference.id}
                                                        label={`Copy ${reference.entity} ID`}
                                                    />
                                                ) : null}
                                            </Row>
                                        ))}
                                    </List>
                                </Section>
                            ) : null}

                            <Section title="Identifiers">
                                <List>
                                    <Row label="Request ID">
                                        <Mono>{event.request_id ?? "—"}</Mono>
                                        {event.request_id ? (
                                            <Copy text={event.request_id} label="Copy request ID" />
                                        ) : null}
                                    </Row>
                                    <Row label="Event ID">
                                        <Mono>{event.event_id ?? "—"}</Mono>
                                        {event.event_id ? (
                                            <Copy text={event.event_id} label="Copy event ID" />
                                        ) : null}
                                    </Row>
                                </List>
                            </Section>

                            <Section
                                title="Attributes"
                                action={
                                    <CopyButton
                                        text={json}
                                        buttonText="Copy JSON"
                                        variant="ghost"
                                    />
                                }
                            >
                                <pre className="m-0 max-h-[360px] overflow-y-auto whitespace-pre-wrap break-all rounded-[10px] border border-solid border-border bg-muted/40 p-3.5 font-mono text-[12px] leading-relaxed text-foreground">
                                    {json}
                                </pre>
                            </Section>
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
