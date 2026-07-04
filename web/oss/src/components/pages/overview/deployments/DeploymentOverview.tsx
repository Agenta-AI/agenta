import {useCallback} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {useRouter} from "next/router"

import EnvironmentCardRow from "@/oss/components/DeploymentsDashboard/components/DeploymentCard/EnvironmentCardRow"
import useURL from "@/oss/hooks/useURL"
import {useAppEnvironments} from "@/oss/state/environment/useAppEnvironments"

const DeploymentOverview = () => {
    const {environments, isEnvironmentsLoading: isDeploymentLoading} = useAppEnvironments()
    const {appURL} = useURL()
    const router = useRouter()

    const handleCardClick = useCallback(
        (env: AppEnvironmentDeployment) => {
            router.push({
                pathname: `${appURL}/variants`,
                query: {
                    tab: "deployments",
                    selectedEnvName: env.name,
                },
            })
        },
        [router, appURL],
    )

    return (
        <div className="flex flex-col gap-2">
            <h3 className="!m-0">Deployment</h3>

            <EnvironmentCardRow
                className="flex gap-4"
                environments={environments}
                isLoading={isDeploymentLoading}
                onCardClick={handleCardClick}
            />
        </div>
    )
}

export default DeploymentOverview
