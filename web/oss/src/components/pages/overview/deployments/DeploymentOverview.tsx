import {useCallback} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

import EnvironmentCardRow from "@/oss/components/DeploymentCard/EnvironmentCardRow"
import useURL from "@/oss/hooks/useURL"
import type {Environment} from "@/oss/lib/Types"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"

const {Title} = Typography

const DeploymentOverview = () => {
    const {environments, isEnvironmentsLoading: isDeploymentLoading} = useEnvironments()
    const {appURL} = useURL()
    const router = useRouter()

    const handleCardClick = useCallback(
        (env: Environment) => {
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
        <div className={clsx(["flex flex-col gap-2", "[&_>_div_h1.ant-typography]:text-xs"])}>
            <Title level={3} className="!m-0">
                Deployment
            </Title>

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
