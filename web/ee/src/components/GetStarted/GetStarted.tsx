import {useCallback, useMemo} from "react"

import OssGetStarted from "@agenta/oss/src/components/GetStarted/GetStarted"
import {message} from "antd"
import {useRouter} from "next/router"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {useOrgData} from "@/oss/state/org"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {useProjectData} from "@/oss/state/project/hooks"

const GetStarted = () => {
    const router = useRouter()
    const posthog = usePostHogAg()
    const {orgs, changeSelectedOrg} = useOrgData()
    const {projects} = useProjectData()

    const demoProject = useMemo(() => projects.find((project) => project.is_demo), [projects])
    const demoWorkspaceId = demoProject?.workspace_id || demoProject?.organization_id || undefined
    const demoOrganizationId = demoProject?.organization_id || undefined
    const demoOrgId = useMemo(() => orgs.find((org) => org.flags?.is_demo)?.id, [orgs])

    const handleDemoSelection = useCallback(async () => {
        posthog?.capture?.("onboarding_selection_v1", {
            selection: "demo",
        })

        if (demoProject && demoWorkspaceId) {
            if (demoOrganizationId) {
                cacheWorkspaceOrgPair(demoWorkspaceId, demoOrganizationId)
            }

            router.push(
                `/w/${encodeURIComponent(demoWorkspaceId)}/p/${encodeURIComponent(
                    demoProject.project_id,
                )}/apps`,
            )
            return
        }

        if (demoOrgId) {
            await changeSelectedOrg(demoOrgId)
            return
        }

        message.error("Demo project is not available.")
    }, [
        changeSelectedOrg,
        demoOrganizationId,
        demoOrgId,
        demoProject,
        demoWorkspaceId,
        posthog,
        router,
    ])

    return (
        <OssGetStarted onSelectDemo={demoProject || demoOrgId ? handleDemoSelection : undefined} />
    )
}

export default GetStarted
