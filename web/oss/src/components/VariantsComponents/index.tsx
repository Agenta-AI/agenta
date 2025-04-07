// @ts-nocheck
import {useCallback, type Key, useMemo, useState} from "react"

import {SwapOutlined} from "@ant-design/icons"
import {Rocket} from "@phosphor-icons/react"
import {Button, Input, message, Radio, Space, Typography} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {useSWRConfig} from "swr"

import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {checkIfResourceValidForDeletion} from "@/oss/lib/helpers/evaluate"
import {groupVariantsByParent, variantNameWithRev} from "@/oss/lib/helpers/variantHelper"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Variant} from "@/oss/lib/Types"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"
import {deleteSingleVariant, deleteSingleVariantRevision} from "@/oss/services/playground/api"

import {getPlaygroundKey} from "../NewPlayground/hooks/usePlayground/assets/helpers"

import {useStyles} from "./assets/styles"
import VariantsTable from "./Table"

const DeleteEvaluationModal = dynamic(
    () => import("@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"),
    {ssr: false},
)
const VariantDrawer = dynamic(
    () => import("@/oss/components/pages/overview/variants/VariantDrawer"),
    {ssr: false},
)
const VariantComparisonModal = dynamic(
    () => import("@/oss/components/pages/overview/variants/VariantComparisonModal"),
    {ssr: false},
)
const DeployVariantModal = dynamic(
    () => import("@/oss/components/NewPlayground/Components/Modals/DeployVariantModal"),
    {ssr: false},
)

const VariantsDashboard = () => {
    const appId = useAppId()
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState("")
    const router = useRouter()
    const {currentApp} = useAppsData()
    const {data, mutate: fetchAllVariants, isLoading} = useVariants(currentApp)({appId})

    const groupedVariants = useMemo(() => groupVariantsByParent(data?.variants), [data?.variants])

    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

    const [queryVariant, setQueryVariant] = useQueryParam("variant")

    const [selectedVariant, setSelectedVariant] = useState<EnhancedVariant>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeployVariantModalOpen, setIsDeployVariantModalOpen] = useState(false)
    const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false)

    const {environments: _environments, mutate: loadEnvironments} = useEnvironments({appId})

    const environments = useMemo(() => {
        return _environments.map((env) => {
            const deployedAppRevisionId = env.deployed_app_variant_revision_id
            const revision = (data?.variants || []).find(
                (variant) => variant.id === deployedAppRevisionId,
            )
            return {
                ...env,
                revision: {
                    ...revision,
                    revisionNumber: revision?.revision || revision?.revisionNumber || 0,
                },
            }
        })
    }, [data?.variants, _environments])
    const {mutate} = useSWRConfig()

    const [displayMode, setDisplayMode] = useQueryParam("displayMode", "flat")

    const filteredVariants = useMemo(() => {
        const variantsToFilter = displayMode === "grouped" ? groupedVariants : data?.variants
        if (displayMode === "grouped") {
            for (const variant of variantsToFilter) {
                const deployedIn = variant.children.flatMap((revision) => revision.deployedIn)
                const isLatest = variant.children.some((revision) => revision.isLatestRevision)
                variant.deployedIn = deployedIn
                variant.isLatestRevision = isLatest
            }
        }
        if (!searchTerm || !variantsToFilter) return variantsToFilter
        return variantsToFilter.filter((item: EnhancedVariant) =>
            item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, groupedVariants, data?.variants, displayMode])

    const flattenAndFilterVariants = (variants: EnhancedVariant[], selectedIds: Key[]) => {
        const result = []

        const traverse = (variant: EnhancedVariant & {children: any}) => {
            if (selectedIds.includes(variant.id)) {
                result.push(variant)
            }
            if (variant.children && variant.children.length > 0) {
                variant.children.forEach(traverse)
            }
        }

        variants.forEach(traverse)
        return result
    }

    const selectedVariantsToCompare = useMemo(() => {
        const variants = flattenAndFilterVariants(filteredVariants || [], selectedRowKeys).filter(
            (variant) => !variant.children,
        )

        return {
            isCompareDisabled: variants.length !== 2,
            compareVariantList: variants,
        }
    }, [selectedRowKeys, filteredVariants])

    const handleNavigation = useCallback(
        (revision?: EnhancedVariant) => {
            const revisions = flattenAndFilterVariants(
                filteredVariants || [],
                selectedRowKeys,
            ).filter((variant) => !variant.children)

            if (revisions && revisions.length) {
                router.push({
                    pathname: `/apps/${appId}/playground`,
                    query: {
                        revisions: JSON.stringify(revisions.map((v) => v.id)),
                    },
                })
            } else {
                router.push({
                    pathname: `/apps/${appId}/playground`,
                    query: revision
                        ? {
                              revisions: JSON.stringify([revision.id]),
                          }
                        : {},
                })
            }
        },
        [appId, router, filteredVariants, selectedRowKeys],
    )

    const handleDeleteVariant = useCallback(
        async (selectedVariant: EnhancedVariant) => {
            try {
                if (
                    !(await checkIfResourceValidForDeletion({
                        resourceType: "variant",
                        resourceIds: [selectedVariant.variantId],
                    }))
                )
                    return

                if (selectedVariant?._parentVariant) {
                    await deleteSingleVariantRevision(selectedVariant.variantId, selectedVariant.id)
                    message.success("Revision removed successfully!")
                } else {
                    await deleteSingleVariant(selectedVariant.variantId)
                    message.success("Variant removed successfully!")
                }
                fetchAllVariants((state) => {
                    if (!state) return state

                    const clonedState = structuredClone(state)

                    if (selectedVariant._parentVariant) {
                        // Handle revision deletion
                        clonedState.variants = [
                            ...clonedState.variants.filter(
                                (variant) => variant.id !== selectedVariant.id,
                            ),
                        ]
                    } else if (!selectedVariant._parentVariant && selectedVariant.children) {
                        // Handle variant deletion
                        clonedState.variants = [
                            ...clonedState.variants.filter(
                                (variant) =>
                                    variant._parentVariant.id !== selectedVariant.variantId,
                            ),
                        ]
                    }

                    return clonedState
                })
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
    }, [loadEnvironments, fetchAllVariants])

    return (
        <>
            <div className={classes.container}>
                <Typography.Text className={classes.title}>Variants</Typography.Text>

                <Space direction="vertical">
                    <div className="flex items-center justify-between">
                        <Input.Search
                            placeholder="Search"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-[400px]"
                            allowClear
                        />
                        <Space>
                            {selectedVariantsToCompare.compareVariantList.length > 0 && (
                                <Typography.Text type="secondary">
                                    {selectedVariantsToCompare.compareVariantList.length} selected
                                </Typography.Text>
                            )}
                            <Space>
                                <Radio.Group
                                    value={displayMode}
                                    onChange={(e) => setDisplayMode(e.target.value)}
                                >
                                    <Radio.Button value="grouped">Variants</Radio.Button>
                                    <Radio.Button value="flat">Revisions</Radio.Button>
                                </Radio.Group>
                            </Space>
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
                        enableColumnResize
                        showEnvBadges
                        variants={filteredVariants || []}
                        onRowClick={(variant) => {
                            setQueryVariant(variant.variantId)
                            setSelectedVariant(variant)
                        }}
                        rowSelection={{
                            onChange: (value) => setSelectedRowKeys(value),
                        }}
                        isLoading={isLoading}
                        handleOpenDetails={(record) => {
                            setQueryVariant(record.variantId)
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
                        handleOpenInPlayground={(record) => handleNavigation(record)}
                    />
                </Space>
            </div>

            {selectedVariant && (
                <VariantDrawer
                    open={!!queryVariant}
                    onClose={() => setQueryVariant("")}
                    selectedVariant={selectedVariant}
                    environments={environments}
                    setIsDeleteEvalModalOpen={setIsDeleteEvalModalOpen}
                    setIsDeployVariantModalOpen={setIsDeployVariantModalOpen}
                />
            )}

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
                    variantId={
                        !selectedVariant._parentVariant ? selectedVariant.variantId : undefined
                    }
                    revisionId={selectedVariant._parentVariant ? selectedVariant.id : undefined}
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

export default VariantsDashboard
