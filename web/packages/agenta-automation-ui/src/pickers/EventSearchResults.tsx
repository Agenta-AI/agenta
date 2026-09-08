import {useCallback, useMemo, useState} from "react"

import type {ConnectedApp} from "./connectedApps"
import {EventSearchGroup} from "./EventSearchGroup"

/** What one app's group has to say about the current query. */
interface GroupReport {
    count: number
    isLoading: boolean
}

/**
 * Search results across every connected app, flat — no rail, each row labelled `App · Event`.
 *
 * "Nothing matches" is a claim about all of them at once, so the groups report up and the
 * sentence waits until none of them are still loading.
 */
export const EventSearchResults = ({
    apps,
    selectedEventKey,
    onPick,
}: {
    apps: ConnectedApp[]
    selectedEventKey: string
    onPick: (connectionId: string, eventKey: string) => void
}) => {
    const [reports, setReports] = useState<Record<string, GroupReport>>({})

    const onReport = useCallback((integrationKey: string, count: number, isLoading: boolean) => {
        setReports((current) => {
            const previous = current[integrationKey]
            if (previous?.count === count && previous.isLoading === isLoading) return current
            return {...current, [integrationKey]: {count, isLoading}}
        })
    }, [])

    const {found, pending} = useMemo(() => {
        let total = 0
        let loading = false
        for (const app of apps) {
            const report = reports[app.integrationKey]
            if (!report || report.isLoading) loading = true
            else total += report.count
        }
        return {found: total, pending: loading}
    }, [apps, reports])

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-px overflow-y-auto">
            {apps.map((app) => (
                <EventSearchGroup
                    key={app.integrationKey}
                    app={app}
                    selectedEventKey={selectedEventKey}
                    onPick={onPick}
                    onReport={onReport}
                />
            ))}
            {!pending && found === 0 ? (
                <p className="m-0 px-2 py-3 text-[12px] leading-snug text-muted-foreground">
                    No event matches that.
                </p>
            ) : null}
        </div>
    )
}
