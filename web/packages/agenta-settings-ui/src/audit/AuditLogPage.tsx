/** Two gates, both the host's to answer: `view_events` shows the tab, the audit
 * entitlement shows the table. */

import {useState, type ReactNode} from "react"

import {Spinner} from "@agenta/ui/ui"

import {UpgradeNotice} from "../access/UpgradeNotice"

import AuditEventDrawer from "./AuditEventDrawer"
import type {AuditLogFiltersProps} from "./AuditLogFilters"
import AuditLogTable from "./AuditLogTable"

export interface AuditLogPageProps {
    /** The audit entitlement. The host resolves it; without it the upgrade notice shows. */
    hasAudit?: boolean
    /**
     * Entitlements still resolving. Deferring rendering avoids a flash of the locked state
     * on first paint — `hasAudit` reads `false` while the queries are in flight.
     */
    entitlementsLoading?: boolean
    /** The date-range control — the desktop's preset picker is the host's. */
    renderDateRange?: AuditLogFiltersProps["renderDateRange"]
    /** The upgrade link on the locked state — routing and billing availability are the host's. */
    upgradeAction?: ReactNode
}

/**
 * The organization's platform events: who did what, and when.
 *
 * A view only — entitlements, the date-range picker and the upgrade link all come from the
 * host, so a surface with none of them still renders the table and its empty state.
 */
export const AuditLogPage = ({
    hasAudit = false,
    entitlementsLoading = false,
    renderDateRange,
    upgradeAction,
}: AuditLogPageProps) => {
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
    const [drawerOpen, setDrawerOpen] = useState(false)

    if (entitlementsLoading) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center py-12">
                <Spinner />
            </div>
        )
    }

    if (!hasAudit) {
        return (
            <UpgradeNotice
                title="Audit Log is not available on your plan"
                description="Query the full history of platform events — who did what, and when — across your organization."
                action={upgradeAction}
            />
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <AuditLogTable
                renderDateRange={renderDateRange}
                onSelectEvent={(eventId) => {
                    setSelectedEventId(eventId)
                    setDrawerOpen(true)
                }}
            />
            <AuditEventDrawer
                eventId={selectedEventId}
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
            />
        </div>
    )
}

export default AuditLogPage
