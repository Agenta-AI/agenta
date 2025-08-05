import {type FC, type Key, useMemo, useState} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import {Button, Flex, Input, Space, Typography, message} from "antd"
import posthog from "posthog-js"
import {createUseStyles} from "react-jss"

import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {DeploymentRevision, DeploymentRevisionConfig, DeploymentRevisions} from "@/oss/lib/Types"
import {JSSTheme} from "@/oss/lib/Types"
import {createPublishRevision} from "@/oss/services/deployment/api"
import {fetchAllDeploymentRevisionConfig} from "@/oss/services/deploymentVersioning/api"

import VariantDrawer from "../VariantsComponents/Drawers/VariantDrawer"

import UseApiContent from "./assets/UseApiContent"
import DeploymentsDrawer from "./components/Drawer"
import DeploymentConfirmationModal from "./components/Modal/DeploymentConfirmationModal"
import SelectDeployVariantModal from "./components/Modal/SelectDeployVariantModal"
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
    variants: EnhancedVariant[]
    deployedVariant: EnhancedVariant
    handleFetchAllDeploymentRevisions: (envName: string) => Promise<void>
}

export type DeploymentRevisionWithVariant = DeploymentRevision & {
    variant: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>> | undefined
    environment_revision: number
}

const DeploymentsDashboard: FC<DeploymentsDashboardProps> = ({
    envRevisions,
    variants,
    deployedVariant,
    handleFetchAllDeploymentRevisions,
}) => {
    const appId = useAppId()
    const classes = useStyles()

    const [searchTerm, setSearchTerm] = useState("")
    const [queryVariant, setQueryVariant] = useQueryParam("revisions")

    const [isUseApiDrawerOpen, setIsUseApiDrawerOpen] = useState(false)
    const [_isRevisionsDetailsDrawerOpen, setIsRevisionsDetailsDrawerOpen] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
    const [note, setNote] = useState("")
    const [isDeployVariantModalOpen, setIsDeployVariantModalOpen] = useState(false)
    const [isDeployVariantLoading, setIsDeployVariantLoading] = useState(false)
    const [_revisionConfig, setRevisionConfig] = useState<DeploymentRevisionConfig | null>(null)
    const [isSelectDeployVariantModalOpen, setIsSelectDeployVariantModalOpen] = useState(false)
    const [selectedRevisionRow, setSelectedRevisionRow] = useState<DeploymentRevisionWithVariant>()

    const [isRevertModalOpen, setIsRevertModalOpen] = useState(false)
    const [isRevertModalLoading, setIsRevertModalLoading] = useState(false)
    const [selectedVariantRevisionIdToRevert, setSelectedVariantRevisionIdToRevert] =
        useState<string>("")

    const selectedVariantToDeploy = useMemo(
        () => variants.find((variant) => variant.id === selectedRowKeys[0]),
        [variants, selectedRowKeys],
    )
    const selectedVariantToRevert = useMemo(
        () => variants.find((variant) => variant.id === selectedVariantRevisionIdToRevert),
        [variants, selectedVariantRevisionIdToRevert],
    )

    const revisions = useMemo(
        () =>
            (envRevisions?.revisions || [])
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((rev, index) => ({
                    ...rev,
                    created_at: formatDay({date: rev.created_at}),
                    variant: variants.find(
                        (variant) => variant.id === rev.deployed_app_variant_revision,
                    ),
                    environment_revision: envRevisions?.revisions?.length
                        ? envRevisions?.revisions?.length - index
                        : 0,
                })),
        [envRevisions, variants],
    )

    const filteredRevisions = useMemo(() => {
        if (!searchTerm) return revisions

        return revisions.filter(
            (item) =>
                `v${item.revision}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.commit_message?.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, revisions])

    const handleFetchRevisionConfig = async (revisionId: string) => {
        try {
            const data = await fetchAllDeploymentRevisionConfig(revisionId)
            setRevisionConfig(data)
            setIsRevisionsDetailsDrawerOpen(true)
        } catch (error) {
            console.error("Failed to fetch revision config:", error)
        }
    }

    const handleDeployVariant = async () => {
        const revisionId = selectedRowKeys[0] as string
        try {
            setIsDeployVariantLoading(true)
            await createPublishRevision({
                note,
                revision_id: revisionId,
                environment_ref: envRevisions?.name || "",
            })
            await handleFetchAllDeploymentRevisions(envRevisions?.name || "")

            message.success(`Published ${deployedVariant?.variantName} to ${envRevisions?.name}`)
            posthog?.capture?.("app_deployed", {app_id: appId, environment: envRevisions?.name})
        } catch (error) {
            console.error("Error deploying variant:", error)
        } finally {
            setNote("")
            setIsDeployVariantModalOpen(false)
            setSelectedRowKeys([])
            setIsSelectDeployVariantModalOpen(false)
            setIsDeployVariantLoading(false)
        }
    }

    const handleRevertDeployment = async () => {
        try {
            setIsRevertModalLoading(true)
            await createPublishRevision({
                note,
                revision_id: selectedVariantRevisionIdToRevert,
                environment_ref: envRevisions?.name || "",
            })
            await handleFetchAllDeploymentRevisions(envRevisions?.name || "")

            posthog?.capture?.("app_deployment_reverted", {
                app_id: appId,
                environment: envRevisions?.name,
            })
            message.success(
                `Published ${selectedVariantToRevert?.variantName} to ${envRevisions?.name}`,
            )
        } catch (error) {
            console.error("Error reverting deployment:", error)
        } finally {
            setNote("")
            setIsRevertModalOpen(false)
            setIsRevertModalLoading(false)
            setSelectedVariantRevisionIdToRevert("")
            setIsRevisionsDetailsDrawerOpen(false)
        }
    }

    return (
        <>
            <Space direction="vertical" size={24}>
                <Flex align="center" justify="space-between">
                    <Typography.Text className={classes.title}>
                        {envRevisions?.name}
                    </Typography.Text>
                    <Space>
                        <Button
                            icon={<CloudArrowUp />}
                            onClick={() => setIsSelectDeployVariantModalOpen(true)}
                        >
                            Deploy variant
                        </Button>
                        <Button type="primary" onClick={() => setIsUseApiDrawerOpen(true)}>
                            Use API
                        </Button>
                    </Space>
                </Flex>

                <div className="flex flex-col gap-2">
                    <div>
                        <Input.Search
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search"
                            allowClear
                            className="w-[400px]"
                        />
                    </div>

                    <DeploymentTable
                        revisions={filteredRevisions}
                        setSelectedRevisionRow={setSelectedRevisionRow}
                        handleFetchRevisionConfig={handleFetchRevisionConfig}
                        setIsRevertModalOpen={setIsRevertModalOpen}
                        setSelectedVariantRevisionIdToRevert={setSelectedVariantRevisionIdToRevert}
                        envRevisions={envRevisions}
                        setIsSelectDeployVariantModalOpen={setIsSelectDeployVariantModalOpen}
                        setQueryVariant={setQueryVariant}
                    />
                </div>
            </Space>

            {/* Use API Drawer */}
            {envRevisions && (
                <DeploymentsDrawer
                    mainContent={
                        <UseApiContent
                            handleOpenSelectDeployVariantModal={() => {
                                setIsUseApiDrawerOpen(false)
                                setIsSelectDeployVariantModalOpen(true)
                            }}
                            variants={variants}
                            selectedEnvironment={envRevisions}
                        />
                    }
                    headerContent={
                        <Typography.Text className={classes.subTitle}>
                            How to use API
                        </Typography.Text>
                    }
                    open={isUseApiDrawerOpen}
                    onClose={() => setIsUseApiDrawerOpen(false)}
                    initialWidth={720}
                />
            )}

            {/* Revisions Details Drawer */}
            <VariantDrawer
                variants={variants || []}
                type="deployment"
                open={!!queryVariant}
                onClose={() => setQueryVariant("")}
                revert={{
                    isDisabled:
                        selectedRevisionRow?.deployed_app_variant_revision ===
                        envRevisions?.deployed_app_variant_revision_id,
                    onClick: () => setIsRevertModalOpen(true),
                    isLoading: isRevertModalLoading,
                }}
            />

            {/* Select Deploy Variant Modal */}
            <SelectDeployVariantModal
                variants={variants}
                envRevisions={envRevisions}
                setIsDeployVariantModalOpen={setIsDeployVariantModalOpen}
                open={isSelectDeployVariantModalOpen}
                onCancel={() => {
                    setSelectedRowKeys([])
                    setIsSelectDeployVariantModalOpen(false)
                }}
                setSelectedRowKeys={setSelectedRowKeys}
                selectedRowKeys={selectedRowKeys}
            />

            {/* Deploy Variant Modal */}
            {selectedVariantToDeploy && (
                <DeploymentConfirmationModal
                    open={isDeployVariantModalOpen}
                    onCancel={() => {
                        setNote("")
                        setIsDeployVariantModalOpen(false)
                    }}
                    okButtonProps={{loading: isDeployVariantLoading}}
                    onOk={handleDeployVariant}
                    note={note}
                    setNote={setNote}
                    variant={selectedVariantToDeploy}
                    envName={envRevisions?.name || ""}
                />
            )}

            {/* Revert Deployment Modal */}
            <DeploymentConfirmationModal
                open={isRevertModalOpen}
                onCancel={() => {
                    setNote("")
                    setIsRevertModalOpen(false)
                    setSelectedVariantRevisionIdToRevert("")
                }}
                onOk={handleRevertDeployment}
                okButtonProps={{loading: isRevertModalLoading}}
                note={note}
                setNote={setNote}
                envName={envRevisions?.name || ""}
                displayNote={false}
                variant={selectedVariantToRevert}
                actionType="revert"
            />
        </>
    )
}

export default DeploymentsDashboard
