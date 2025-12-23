import {type FC, useEffect} from "react"

import {CloudArrowUpIcon, CodeSimpleIcon} from "@phosphor-icons/react"
import {Button, Input, Space, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {createUseStyles} from "react-jss"

import {openDeploymentsDrawerAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"
import {
    openDeploymentConfirmationModalAtom,
    openSelectDeployVariantModalAtom,
} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"
import {DeploymentRevisions} from "@/oss/lib/Types"
import {JSSTheme} from "@/oss/lib/Types"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"

import {revisionListAtom} from "../Playground/state/atoms"

import {
    deploymentSearchAtom,
    selectedRevisionRowAtom,
    selectedVariantRevisionIdToRevertAtom,
    envRevisionsAtom,
    filteredDeploymentRevisionsAtom,
    selectedVariantToRevertAtom,
} from "./atoms"
import DeploymentTable from "./components/Table"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
        textTransform: "capitalize",
    },
    subTitle: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
}))

interface DeploymentsDashboardProps {
    envRevisions: DeploymentRevisions | undefined
    isLoading: boolean
    selectedEnvName: string
}

const DeploymentsDashboard: FC<DeploymentsDashboardProps> = ({
    envRevisions,
    selectedEnvName,
    isLoading,
}) => {
    const {mutateAsync: publish} = useAtomValue(publishMutationAtom)
    const classes = useStyles()

    // Sync envRevisions prop with atom
    const setEnvRevisions = useSetAtom(envRevisionsAtom)
    useEffect(() => {
        setEnvRevisions(envRevisions)
    }, [envRevisions, setEnvRevisions])

    const variants = useAtomValue(revisionListAtom) || []

    // Optimized state management with atoms
    const [searchTerm, setSearchTerm] = useAtom(deploymentSearchAtom)
    // Keep some local state for now to avoid breaking existing functionality
    const [, setSelectedRevisionRow] = useAtom(selectedRevisionRowAtom)
    const [selectedVariantRevisionIdToRevert, setSelectedVariantRevisionIdToRevert] = useAtom(
        selectedVariantRevisionIdToRevertAtom,
    )

    // Global modal openers
    const openSelectDeployVariantModal = useSetAtom(openSelectDeployVariantModalAtom)
    const openDeploymentConfirmationModal = useSetAtom(openDeploymentConfirmationModalAtom)
    const openDeploymentsDrawer = useSetAtom(openDeploymentsDrawerAtom)

    // Atom-based computed values
    const selectedVariantToRevert = useAtomValue(selectedVariantToRevertAtom)
    const revisions = useAtomValue(filteredDeploymentRevisionsAtom)

    // Deep-link handling moved to DeploymentsDrawerWrapper

    return (
        <Space direction="vertical" size={8}>
            <Typography.Text className={classes.title}>
                {envRevisions?.name || selectedEnvName}
            </Typography.Text>

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Input.Search
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search"
                        allowClear
                        className="w-[400px]"
                    />

                    <Space>
                        <Button
                            icon={<CloudArrowUpIcon />}
                            onClick={() =>
                                openSelectDeployVariantModal({variants, envRevisions: envRevisions})
                            }
                        >
                            Deploy
                        </Button>
                        <Button
                            type="primary"
                            icon={<CodeSimpleIcon size={14} />}
                            onClick={() =>
                                envRevisions &&
                                openDeploymentsDrawer({
                                    initialWidth: 720,
                                    mode: "deployment",
                                    envName: envRevisions.name,
                                })
                            }
                        >
                            Use API
                        </Button>
                    </Space>
                </div>

                <DeploymentTable
                    revisions={revisions}
                    setSelectedRevisionRow={setSelectedRevisionRow}
                    setIsRevertModalOpen={(isOpen) => {
                        if (!isOpen) return
                        const envName = envRevisions?.name || ""
                        openDeploymentConfirmationModal({
                            envName,
                            actionType: "revert",
                            variant: selectedVariantToRevert || undefined,
                            onConfirm: async (noteValue) => {
                                await publish({
                                    type: "revision",
                                    note: noteValue,
                                    revision_id: selectedVariantRevisionIdToRevert,
                                    environment_ref: envName,
                                })
                            },
                        })
                    }}
                    setSelectedVariantRevisionIdToRevert={setSelectedVariantRevisionIdToRevert}
                    envRevisions={envRevisions}
                    setIsSelectDeployVariantModalOpen={() =>
                        openSelectDeployVariantModal({variants, envRevisions: envRevisions})
                    }
                    onOpenUseApi={({revisionId} = {}) => {
                        if (envRevisions) {
                            openDeploymentsDrawer({
                                initialWidth: 720,
                                revisionId,
                                deploymentRevisionId: revisionId,
                                envName: envRevisions.name,
                                mode: "deployment",
                            })
                        }
                    }}
                    isLoading={isLoading}
                />
            </div>
        </Space>
    )
}

export default DeploymentsDashboard
