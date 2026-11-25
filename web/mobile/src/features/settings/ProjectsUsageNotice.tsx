import {useState} from "react"

import {useT} from "@agenta/i18n"
import limitRefusalCatalog from "@agenta/i18n/catalogs/shell.limitRefusal"
import {Button} from "@agenta/ui/ui"

import {RegistrationDialog} from "../limits/RegistrationDialog"

import {useInstanceLicense} from "./useInstanceLicense"

/**
 * Settings > Projects, for the instance admin of an instance with no key: how many projects
 * the organization uses of its limit, and the registration that lifts it. It shows before the
 * limit is hit.
 */
export const ProjectsUsageNotice = ({projectId}: {projectId: string}) => {
    const t = useT(limitRefusalCatalog)
    const license = useInstanceLicense(projectId)
    const [registering, setRegistering] = useState(false)
    const projects = license.data?.usage.projects
    if (!license.data || license.data.license || !projects || projects.limit === null) return null

    return (
        <div className="bg-colorInfoBg ring-colorInfoBorder mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 ring-1 ring-inset">
            <p className="text-foreground m-0 text-[13px]">
                {t("shell.limitRefusal.projectsUsage", {
                    count: projects.count,
                    limit: projects.limit,
                })}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => setRegistering(true)}>
                {t("shell.limitRefusal.register")}
            </Button>
            <RegistrationDialog
                open={registering}
                title={t("shell.limitRefusal.registerTitle")}
                projectId={projectId}
                onClose={() => setRegistering(false)}
            />
        </div>
    )
}
