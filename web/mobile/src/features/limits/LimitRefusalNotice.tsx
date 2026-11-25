import {useT} from "@agenta/i18n"
import limitRefusalCatalog from "@agenta/i18n/catalogs/shell.limitRefusal"
import {isBillingEnabled} from "@agenta/shared/api"
import {Button} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import type {LimitRefusal} from "./limitRefusal"
import {OrganizationLimitNotice} from "./OrganizationLimitNotice"
import {ProjectLimitNotice} from "./ProjectLimitNotice"

/**
 * A refusal at the plan's limit after submit. Self-hosted shows the same notice the dialog shows
 * when it opens at the limit (a refusal means the count reached it); cloud offers the plan
 * upgrade in Billing.
 */
export const LimitRefusalNotice = ({
    refusal,
    workspaceId,
    projectId,
    onNavigate,
}: {
    refusal: LimitRefusal
    workspaceId: string
    projectId: string
    /** Called before a next step opens Settings, so a dialog can close. */
    onNavigate?: () => void
}) => {
    const usage = {count: refusal.limit, limit: refusal.limit}
    if (refusal.code === "instance_organization_limit_reached") {
        return (
            <OrganizationLimitNotice
                usage={usage}
                workspaceId={workspaceId}
                projectId={projectId}
                onNavigate={onNavigate}
            />
        )
    }
    if (!isBillingEnabled()) return <ProjectLimitNotice usage={usage} projectId={projectId} />
    return (
        <CloudProjectLimitNotice
            workspaceId={workspaceId}
            projectId={projectId}
            onNavigate={onNavigate}
        />
    )
}

/** The cloud Hobby plan's project limit, with the upgrade in Billing. */
const CloudProjectLimitNotice = ({
    workspaceId,
    projectId,
    onNavigate,
}: {
    workspaceId: string
    projectId: string
    onNavigate?: () => void
}) => {
    const t = useT(limitRefusalCatalog)
    const router = useRouter()

    return (
        <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-destructive m-0 text-xs">
                {t("shell.limitRefusal.projectLimitCloud")}
            </p>
            <Button
                size="sm"
                variant="outline"
                onClick={() => {
                    onNavigate?.()
                    void router.push(`/w/${workspaceId}/p/${projectId}/settings?tab=billing`)
                }}
            >
                {t("shell.limitRefusal.upgradePlan")}
            </Button>
        </div>
    )
}
