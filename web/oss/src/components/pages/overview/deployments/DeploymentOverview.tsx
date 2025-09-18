import {useCallback} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

import DeploymentCard from "@/oss/components/DeploymentCard"
import type {Environment} from "@/oss/lib/Types"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"
import {getAppValues} from "@/oss/state/app"

const {Title} = Typography

interface WrappedDeploymentCardProps {
    env: Environment
}
const WrappedDeploymentCard = ({env}: WrappedDeploymentCardProps) => {
    const router = useRouter()
    const handleClick = useCallback(() => {
        const appId = getAppValues()?.currentApp?.app_id
        router.push({
            pathname: `/apps/${appId}/deployments`,
            query: {
                selectedEnvName: env.name,
            },
        })
    }, [env?.name])

    return <DeploymentCard onClick={handleClick} env={env} />
}

const DeploymentOverview = () => {
    const {environments, isEnvironmentsLoading: isDeploymentLoading} = useEnvironments()

    return (
        <div className={clsx(["flex flex-col gap-2", "[&_>_div_h1.ant-typography]:text-xs"])}>
            <Title>Deployment</Title>

            {isDeploymentLoading ? (
                <div className="flex gap-2">
                    {Array.from({length: 3}).map((_: undefined, index: number) => (
                        <Skeleton key={index} />
                    ))}
                </div>
            ) : (
                <div className={clsx(["flex gap-4"])}>
                    {environments.map((env: Environment, index: number) => {
                        return <WrappedDeploymentCard key={index} env={env} />
                    })}
                </div>
            )}
        </div>
    )
}

export default DeploymentOverview
