/**
 * Audit Log — Settings Tab
 *
 * Lists platform events from `POST /events/query` in a paginated table with a
 * right-side detail drawer.
 *
 * Two-gate access model:
 *   - Tab VISIBILITY is a permission check (`view_events`), handled by the
 *     settings sidebar / page (`canViewEvents`).
 *   - Page CONTENT is gated by the `Flag.AUDIT` entitlement: with it, the table
 *     renders; without it, an UpgradePrompt CTA is shown instead.
 *
 * In OSS the backend skips the entitlement check entirely, so the content is
 * always available — the EE-only `useEntitlements()` query is not mounted in OSS.
 */

import {Spin} from "antd"

import {UpgradePrompt} from "@/oss/components/pages/settings/Organization/UpgradePrompt"
import {isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"

import AuditEventDrawer from "./components/AuditEventDrawer"
import AuditLogTable from "./components/AuditLogTable"

const AuditLogContent = () => (
    <div className="flex flex-1 min-h-0 flex-col">
        <AuditLogTable />
        <AuditEventDrawer />
    </div>
)

const NotEntitled = () => (
    <UpgradePrompt
        title="Audit Log is not available on your plan"
        description="Query the full history of platform events — who did what, and when — across your organization."
    />
)

/** EE wrapper — defers rendering until entitlements resolve to avoid a flash. */
const AuditLogGated = () => {
    const {hasAudit, isLoading} = useEntitlements()

    if (isLoading) {
        return (
            <div className="flex flex-1 min-h-0 items-center justify-center">
                <Spin />
            </div>
        )
    }

    return hasAudit ? <AuditLogContent /> : <NotEntitled />
}

const AuditLog = () => {
    // `isEE()` is env-derived and stable for the session, so branching the
    // component tree on it (rather than a conditional hook) is safe.
    return isEE() ? <AuditLogGated /> : <AuditLogContent />
}

export default AuditLog
