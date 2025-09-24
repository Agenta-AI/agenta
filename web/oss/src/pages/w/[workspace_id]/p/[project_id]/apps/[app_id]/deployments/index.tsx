// @ts-nocheck
import {useMemo, useState, useEffect} from "react"

import {Flex, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import DeploymentCard from "@/oss/components/DeploymentCard"
import DeploymentsDashboard from "@/oss/components/DeploymentsDashboard"
import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {JSSTheme} from "@/oss/lib/Types"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"
import {deploymentRevisionsWithAppIdQueryAtomFamily} from "@/oss/state/deployment/atoms/revisions"
import {deployedVariantByEnvironmentAtomFamily} from "@/oss/state/variant/atoms/fetcher"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.marginLG,
    },
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

// Child component to safely read per-environment deployed variant
const EnvDeploymentCard = ({
    envName,
    selectedEnv,
    onSelect,
    isLoading,
}: {
    envName: string
    selectedEnv: string
    onSelect: (env: string) => void
    isLoading: boolean
}) => {
    const deployedVariant = useAtomValue(deployedVariantByEnvironmentAtomFamily(envName))
    return (
        <DeploymentCard
            onClick={() => onSelect(envName)}
            selectedDeployedVariant={deployedVariant}
            env={{name: envName} as any}
            selectedEnv={selectedEnv}
            loading={isLoading}
        />
    )
}

const DeploymentsPage = () => {
    const classes = useStyles()
    const router = useRouter()
    const [initialEnv] = useQueryParam("selectedEnvName", "development")

    // Use local state for selectedEnv to prevent page flashing
    const [selectedEnv, setSelectedEnvLocal] = useState(initialEnv)

    // Sync local state with URL on mount and when URL changes
    useEffect(() => {
        setSelectedEnvLocal(initialEnv)
    }, [initialEnv])

    // Function to update both local state and URL (shallow)
    const setSelectedEnv = (envName: string) => {
        setSelectedEnvLocal(envName)
        // Update URL with shallow routing to prevent page reload
        router.push(
            {
                pathname: router.pathname,
                query: {...router.query, selectedEnvName: envName},
            },
            undefined,
            {shallow: true},
        )
    }

    const appId = useAppId()
    const {environments, isEnvironmentsLoading} = useEnvironments({appId})
    const selectedDeployedVariantAtom = deployedVariantByEnvironmentAtomFamily(selectedEnv)
    const selectedDeployedVariant = useAtomValue(selectedDeployedVariantAtom)

    // Use atom for deployment revisions instead of manual state
    const deploymentRevisionsAtom = deploymentRevisionsWithAppIdQueryAtomFamily({
        appId,
        envName: selectedEnv,
    })
    const {data: envRevisions} = useAtomValue(deploymentRevisionsAtom)

    const deployedVariant = useMemo(() => {
        // Use per-environment selector exclusively
        return selectedDeployedVariant ?? null
    }, [selectedDeployedVariant])

    return (
        <div className={classes.container}>
            <Typography.Text className={classes.title}>Deployment</Typography.Text>

            <Flex align="center" gap={16}>
                {environments.map((env, index) => (
                    <EnvDeploymentCard
                        key={index}
                        envName={env.name}
                        onSelect={setSelectedEnv}
                        selectedEnv={selectedEnv}
                        isLoading={isEnvironmentsLoading}
                    />
                ))}
            </Flex>

            <DeploymentsDashboard
                envRevisions={envRevisions}
                deployedVariant={deployedVariant}
                isLoading={isEnvironmentsLoading}
            />
        </div>
    )
}

export default DeploymentsPage
