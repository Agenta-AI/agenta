// @ts-nocheck
import {useCallback, useMemo, useState} from "react"

import {SwapOutlined} from "@ant-design/icons"
import {Rocket} from "@phosphor-icons/react"
import {Button, message, Space, Typography} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import {useSWRConfig} from "swr"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import {getPlaygroundKey} from "@/oss/components/Playground/hooks/usePlayground/assets/helpers"
import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {checkIfResourceValidForDeletion} from "@/oss/lib/helpers/evaluate"
import {variantNameWithRev} from "@/oss/lib/helpers/variantHelper"
import {Environment, JSSTheme, Variant} from "@/oss/lib/Types"
import {deleteSingleVariantRevision} from "@/oss/services/playground/api"

import VariantDrawer from "../../../VariantsComponents/Drawers/VariantDrawer"
import VariantComparisonModal from "../../../VariantsComponents/Modals/VariantComparisonModal"

const DeployVariantModal = dynamic(
    () => import("@/oss/components/Playground/Components/Modals/DeployVariantModal"),
    {ssr: false},
)
const {Title} = Typography

interface VariantsOverviewProps {
    isVariantLoading: boolean
    variantList: Variant[]
    environments: Environment[]
    fetchAllVariants: () => void
    loadEnvironments: () => Promise<void>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > div h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
}))

const VariantsOverview = ({
    variantList = [],
    isVariantLoading,
    environments: propsEnvironments,
    fetchAllVariants,
    loadEnvironments,
}: VariantsOverviewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [queryVariant, setQueryVariant] = useQueryParam("revisions")
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectedVariant, setSelectedVariant] = useState<Variant>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeployVariantModalOpen, setIsDeployVariantModalOpen] = useState(false)
    const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false)
    const {mutate} = useSWRConfig()

    const slicedVariantList = useMemo(() => {
        const sorted = variantList
            .sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp)
            .slice(0, 5)
        return sorted
    }, [variantList])

    const selectedVariantsToCompare = useMemo(() => {
        const variants = slicedVariantList.filter((variant) => selectedRowKeys.includes(variant.id))
        return {
            isCompareDisabled: variants.length !== 2,
            compareVariantList: variants,
        }
    }, [selectedRowKeys])

    const environments = useMemo(() => {
        return propsEnvironments.map((env) => {
            const deployedAppRevisionId = env.deployed_app_variant_revision_id
            const revision = variantList?.find((variant) => variant.id === deployedAppRevisionId)
            return {
                ...env,
                revision: {
                    ...revision,
                    revisionNumber: revision?.revision || revision?.revisionNumber || 0,
                },
            }
        })
    }, [propsEnvironments])

    const handleNavigation = useCallback(
        (record: EnhancedVariant) => {
            if (selectedRowKeys.length) {
                router.push({
                    pathname: `/apps/${appId}/playground`,
                    query: {revisions: JSON.stringify(selectedRowKeys)},
                })
            } else {
                router.push({
                    pathname: `/apps/${appId}/playground`,
                    query: record ? {revisions: JSON.stringify([record.id])} : {},
                })
            }
        },
        [appId, router, selectedRowKeys],
    )

    const handleDeleteVariant = useCallback(
        async (selectedVariant: Variant) => {
            try {
                if (
                    !(await checkIfResourceValidForDeletion({
                        resourceType: "variant",
                        resourceIds: [selectedVariant.variantId],
                    }))
                )
                    return

                await deleteSingleVariantRevision(selectedVariant.variantId, selectedVariant.id)
                message.success("Variant removed successfully!")
                fetchAllVariants(
                    (state) => {
                        if (!state) return state

                        const clonedState = structuredClone(state)

                        if (selectedVariant._parentVariant) {
                            console.log("DELETE REVISION")
                            // Handle revision deletion
                            clonedState.variants = clonedState.variants.filter(
                                (variant) => variant.id !== selectedVariant.id,
                            )
                        } else if (!selectedVariant._parentVariant && electedVariant.children) {
                            console.log("DELETE VARIANT")
                            // Handle variant deletion
                            clonedState.variants = clonedState.variants.filter(
                                (variant) =>
                                    variant._parentVariant.id !== selectedVariant.variantId,
                            )
                        }

                        return clonedState
                    },
                    {
                        revalidate: false,
                    },
                )
            } catch (error) {
                console.error(error)
            }

            await mutate(getPlaygroundKey(), (playgroundState) => {
                if (!playgroundState) return playgroundState
                if (playgroundState.selected.includes(selectedVariant.variantId)) {
                    playgroundState.selected.splice(
                        playgroundState.selected.indexOf(selectedVariant.variantId),
                        1,
                    )
                }

                playgroundState.variants = playgroundState.variants.filter(
                    (variant) => (variant.variantId || variant.id) !== selectedVariant.variantId,
                )

                return playgroundState
            })

            setIsDeleteEvalModalOpen(false)
        },
        [fetchAllVariants],
    )

    const handleDeployment = useCallback(() => {
        mutate(getPlaygroundKey())
        loadEnvironments()
        fetchAllVariants()
    }, [mutate, loadEnvironments])

    return (
        <>
            <div className={classes.container}>
                <div className="flex items-center justify-between">
                    <Space>
                        <Title>Recent Prompts</Title>
                        <Button href={`/apps/${appId}/variants`}>View all</Button>
                    </Space>

                    <Space>
                        <Button
                            type="link"
                            disabled={selectedVariantsToCompare.isCompareDisabled}
                            icon={<SwapOutlined />}
                            onClick={() => setIsComparisonModalOpen(true)}
                        >
                            Compare
                        </Button>

                        <Button
                            icon={<Rocket size={14} className="mt-[3px]" />}
                            onClick={() => handleNavigation()}
                        >
                            Playground
                        </Button>
                    </Space>
                </div>

                <VariantsTable
                    showEnvBadges
                    variants={slicedVariantList}
                    onRowClick={(variant) => {
                        setQueryVariant(JSON.stringify([variant._revisionId ?? variant.id]))
                        setSelectedVariant(variant)
                    }}
                    rowSelection={{onChange: (value) => setSelectedRowKeys(value)}}
                    isLoading={isVariantLoading}
                    handleOpenDetails={(record) => {
                        setQueryVariant(JSON.stringify([variant._revisionId ?? variant.id]))
                        setSelectedVariant(record)
                    }}
                    handleDeleteVariant={(record) => {
                        setSelectedVariant(record)
                        setIsDeleteEvalModalOpen(true)
                    }}
                    handleDeploy={(record) => {
                        setIsDeployVariantModalOpen(true)
                        setSelectedVariant(record)
                    }}
                    handleOpenInPlayground={(record) => {
                        handleNavigation(record)
                    }}
                />
            </div>

            <VariantDrawer
                open={!!queryVariant}
                onClose={() => setQueryVariant("")}
                variants={variantList}
                type="variant"
            />

            {selectedVariant && (
                <DeleteEvaluationModal
                    open={isDeleteEvalModalOpen}
                    onCancel={() => setIsDeleteEvalModalOpen(false)}
                    onOk={() => handleDeleteVariant(selectedVariant)}
                    evaluationType={variantNameWithRev({
                        variant_name: selectedVariant.variantName,
                        revision: selectedVariant.revision,
                    })}
                />
            )}

            {selectedVariant && (
                <DeployVariantModal
                    open={isDeployVariantModalOpen}
                    onCancel={() => setIsDeployVariantModalOpen(false)}
                    variantId={!selectedVariant._parentVariant ? selectedVariant.variantId : null}
                    revisionId={selectedVariant._parentVariant ? selectedVariant.id : null}
                    environments={environments}
                    variantName={selectedVariant.variantName}
                    revision={selectedVariant.revision}
                    mutate={handleDeployment}
                />
            )}

            {!selectedVariantsToCompare.isCompareDisabled && (
                <VariantComparisonModal
                    open={isComparisonModalOpen}
                    onCancel={() => setIsComparisonModalOpen(false)}
                    compareVariantList={selectedVariantsToCompare.compareVariantList}
                />
            )}
        </>
    )
}

export default VariantsOverview
