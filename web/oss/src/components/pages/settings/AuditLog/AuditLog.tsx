/**
 * Audit Log — Settings Tab
 *
 * Lists platform events from `POST /events/query` in a paginated table with a
 * right-side detail drawer.
 *
 * Entitlement: in EE the audit log is gated by `Flag.AUDIT` (Business /
 * Enterprise). In OSS the backend skips the entitlement check entirely, so the
 * tab is always available — the EE-only `useEntitlements()` query is therefore
 * not even mounted in OSS.
 */

import {Result, Spin} from "antd"

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
    <Result
        status="info"
        title="Audit Log is not available on your plan"
        subTitle="Upgrade to a Business or Enterprise plan to query the full history of platform events."
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
