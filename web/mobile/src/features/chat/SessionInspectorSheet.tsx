import {useMemo, useState} from "react"

import {
    revalidateSessionRecordsAtom,
    sessionRecordsQueryFamily,
    type SessionRecord,
} from "@agenta/entities/session"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowClockwise, DownloadSimple, MagnifyingGlass} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@/components/ui/sheet"

const EMPTY_RECORDS: SessionRecord[] = []

const recordTitle = (record: SessionRecord) => {
    const payloadType =
        record.payload && typeof record.payload.type === "string" ? record.payload.type : null
    return record.session_update || payloadType || record.sender || "record"
}

const downloadRecords = (sessionId: string, records: SessionRecord[]) => {
    const blob = new Blob([JSON.stringify(records, null, 2)], {type: "application/json"})
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = `session-${sessionId.slice(0, 8)}.json`
    anchor.click()
    URL.revokeObjectURL(href)
}

const SessionInspectorSheet = ({
    sessionId,
    open,
    onOpenChange,
}: {
    sessionId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) => {
    const recordsQuery = useAtomValue(sessionRecordsQueryFamily(open ? sessionId : ""))
    const revalidate = useSetAtom(revalidateSessionRecordsAtom)
    const records = recordsQuery.data ?? EMPTY_RECORDS
    const turnCount = useMemo(
        () => new Set(records.map((record) => record.turn_id).filter(Boolean)).size,
        [records],
    )

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="responsive" className="gap-0 overflow-hidden p-0">
                <SheetHeader className="border-b pr-12">
                    <SheetTitle>Session inspector</SheetTitle>
                    <SheetDescription className="break-all font-mono text-xs">
                        {sessionId}
                    </SheetDescription>
                    <div className="flex items-center gap-2 pt-1">
                        <span className="text-xs text-muted-foreground">
                            {records.length} records · {turnCount} turns
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                            <SimpleTooltip title="Refresh">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Refresh session inspector"
                                    onClick={() => revalidate(sessionId)}
                                >
                                    <ArrowClockwise size={14} />
                                </Button>
                            </SimpleTooltip>
                            <SimpleTooltip title="Export JSON">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Export session records"
                                    disabled={records.length === 0}
                                    onClick={() => downloadRecords(sessionId, records)}
                                >
                                    <DownloadSimple size={14} />
                                </Button>
                            </SimpleTooltip>
                        </div>
                    </div>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {recordsQuery.isLoading ? (
                        <p className="m-0 text-sm text-muted-foreground">Loading records…</p>
                    ) : recordsQuery.isError ? (
                        <p className="text-destructive m-0 text-sm">
                            Session records could not be loaded.
                        </p>
                    ) : records.length === 0 ? (
                        <p className="m-0 text-sm text-muted-foreground">
                            This session has no records yet.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {records.map((record) => (
                                <details key={record.id} className="rounded-lg border px-3 py-2">
                                    <summary className="cursor-pointer text-xs font-medium">
                                        <span>{recordTitle(record)}</span>
                                        {record.sequence != null ? (
                                            <span className="ml-2 font-mono text-muted-foreground">
                                                #{record.sequence}
                                            </span>
                                        ) : null}
                                    </summary>
                                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
                                        {JSON.stringify(record, null, 2)}
                                    </pre>
                                </details>
                            ))}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}

export const InspectSessionButton = ({sessionId}: {sessionId: string}) => {
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const [open, setOpen] = useState(false)

    if (!inspectorEnabled) return null

    return (
        <>
            <SimpleTooltip title="Inspect session">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Inspect session"
                    onClick={() => setOpen(true)}
                    className="h-7 w-7 shrink-0 p-0"
                >
                    <MagnifyingGlass size={14} />
                </Button>
            </SimpleTooltip>
            <SessionInspectorSheet sessionId={sessionId} open={open} onOpenChange={setOpen} />
        </>
    )
}
