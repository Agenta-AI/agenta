/**
 * Audit Log — EE binding.
 *
 * The page itself is `@agenta/settings-ui`'s. This file supplies the three things that are
 * this host's: the audit entitlement, the desktop's date-range picker, and the upgrade link.
 */

import {AuditLogPage} from "@agenta/settings-ui"
import {useAtomValue} from "jotai"
import Link from "next/link"

import QuickDateRangePicker from "@/oss/components/EvaluationRunsTablePOC/components/filters/QuickDateRangePicker"
import {isBillingEnabled} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {appIdentifiersAtom} from "@/oss/state/appState/atoms"

const UpgradeLink = () => {
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    if (!isBillingEnabled() || !workspaceId || !projectId) return null

    return (
        <Link
            href={`/w/${workspaceId}/p/${projectId}/settings?tab=billing&upgrade=true`}
            className="font-medium"
        >
            Upgrade plan →
        </Link>
    )
}

const AuditLog = () => {
    const {hasAudit, isLoading} = useEntitlements()

    return (
        <AuditLogPage
            hasAudit={hasAudit}
            entitlementsLoading={isLoading}
            renderDateRange={({value, onChange}) => (
                <QuickDateRangePicker value={value} onChange={onChange} />
            )}
            upgradeAction={<UpgradeLink />}
        />
    )
}

export default AuditLog
