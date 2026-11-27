import {useState} from "react"

import {useT} from "@agenta/i18n"
import limitRefusalCatalog from "@agenta/i18n/catalogs/shell.limitRefusal"
import {Button} from "@agenta/ui/ui"

import {RegistrationDialog} from "../limits/RegistrationDialog"

import {useInstanceLicense} from "./useInstanceLicense"
import {useLicenseUsage} from "./useLicenseUsage"

/**
 * Settings > Projects, for the instance admin of an instance with a project limit (no key):
 * how many projects the organization uses of its limit, and the registration that lifts it. It
 * shows before the limit is hit.
 */
export const ProjectsUsageNotice = ({projectId}: {projectId: string}) => {
    const t = useT(limitRefusalCatalog)
    const {isInstanceAdmin} = useInstanceLicense(projectId)
    const usage = useLicenseUsage(projectId)
    const [registering, setRegistering] = useState(false)
    const projects = usage.data?.projects
    if (!isInstanceAdmin || !projects || projects.limit === null) return null

    return (
        <div className="bg-info/10 ring-info/30 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 ring-1 ring-inset">
            <p className="text-foreground m-0 text-body-sm">
                {t(
                    projects.count > projects.limit
                        ? "shell.limitRefusal.projectsUsageOverLimit"
                        : "shell.limitRefusal.projectsUsage",
                    {count: projects.count, limit: projects.limit},
                )}
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
