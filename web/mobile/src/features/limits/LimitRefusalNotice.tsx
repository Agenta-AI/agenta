import {useT} from "@agenta/i18n"
import limitRefusalCatalog from "@agenta/i18n/catalogs/shell.limitRefusal"
import {isBillingEnabled} from "@agenta/shared/api"
import {Button} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import {useInstanceLicense} from "../settings/useInstanceLicense"

import {limitNextStep, limitRefusalText, type LimitRefusal} from "./limitRefusal"

/** A project or organization refusal at the plan's limit, with the reader's next step. */
export const LimitRefusalNotice = ({
    refusal,
    workspaceId,
    projectId,
    onNavigate,
}: {
    refusal: LimitRefusal
    workspaceId: string
    projectId: string
    /** Called before the next step opens Settings, so a dialog can close. */
    onNavigate?: () => void
}) => {
    const t = useT(limitRefusalCatalog)
    const router = useRouter()
    const cloud = isBillingEnabled()
    const {isInstanceAdmin} = useInstanceLicense(projectId)
    const step = limitNextStep({refusal, cloud, isInstanceAdmin})
    const openTab = (tab: "billing" | "license") => {
        onNavigate?.()
        void router.push(`/w/${workspaceId}/p/${projectId}/settings?tab=${tab}`)
    }

    return (
        <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-destructive m-0 text-xs">
                {limitRefusalText(refusal, {cloud, isInstanceAdmin})}
                {step === "askAdmin" ? ` ${t("shell.limitRefusal.askInstanceAdmin")}` : null}
            </p>
            {step === "askAdmin" ? null : (
                <Button size="sm" variant="outline" onClick={() => openTab(step)}>
                    {step === "billing"
                        ? t("shell.limitRefusal.upgradePlan")
                        : refusal.code === "project_limit_reached"
                          ? t("shell.limitRefusal.registerInstance")
                          : t("shell.limitRefusal.openLicenseSettings")}
                </Button>
            )}
        </div>
    )
}
