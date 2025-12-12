// @ts-nocheck
import {useEffect, useMemo, useState} from "react"

import {Flex, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import DeploymentsDashboard from "@/oss/components/DeploymentsDashboard"
import EnvironmentCardRow from "@/oss/components/DeploymentsDashboard/components/DeploymentCard/EnvironmentCardRow"
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

const DeploymentsPage = () => {
    const classes = useStyles()
    const router = useRouter()
    const [initialEnv, setInitialEnv] = useQueryParam("selectedEnvName", "development")
    const [selectedEnv, setSelectedEnvLocal] = useState(initialEnv)

    useEffect(() => {
        const fromUrl = router.query.selectedEnvName
        if (!fromUrl && !!selectedEnv) {
            setInitialEnv(selectedEnv)
        }
    }, [selectedEnv])
    // Sync local state with URL on mount and when URL changes
    useEffect(() => {
        setSelectedEnvLocal((prev) => (prev === initialEnv ? prev : initialEnv))
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
    const deploymentRevisionsAtom = useMemo(
        () => deploymentRevisionsWithAppIdQueryAtomFamily({appId, envName: selectedEnv}),
        [appId, selectedEnv],
    )
    const {data: envRevisions} = useAtomValue(deploymentRevisionsAtom)

    const deployedVariant = useMemo(() => {
        // Use per-environment selector exclusively
        return selectedDeployedVariant ?? null
    }, [selectedDeployedVariant])

    return (
        <div className={classes.container}>
            <Typography.Text className="text-[16px] font-medium">Deployment</Typography.Text>

            <Flex align="center" gap={16}>
                <EnvironmentCardRow
                    environments={environments}
                    isLoading={isEnvironmentsLoading}
                    selectedEnvName={selectedEnv}
                    onCardClick={(env) => setSelectedEnv(env.name)}
                />
            </Flex>

            <DeploymentsDashboard
                selectedEnv={selectedEnv}
                envRevisions={envRevisions}
                deployedVariant={deployedVariant}
                isLoading={isEnvironmentsLoading}
            />
        </div>
    )
}

export default DeploymentsPage
