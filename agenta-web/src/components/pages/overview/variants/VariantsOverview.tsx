import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {MoreOutlined, SwapOutlined} from "@ant-design/icons"
import {CloudArrowUp, Copy, GearSix, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, message, Space, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import React, {useCallback, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import VariantDrawer from "./VariantDrawer"
import {useQueryParam} from "@/hooks/useQuery"
import {filterVariantParameters, isDemo} from "@/lib/helpers/utils"
import {checkIfResourceValidForDeletion} from "@/lib/helpers/evaluate"
import {deleteSingleVariant} from "@/services/playground/api"
import DeleteEvaluationModal from "@/components/DeleteEvaluationModal/DeleteEvaluationModal"
import DeployVariantModal from "./DeployVariantModal"
import VariantComparisonModal from "./VariantComparisonModal"

const {Title} = Typography

interface VariantsOverviewProps {
    isVariantLoading: boolean
    variantList: Variant[]
    environments: Environment[]
    fetchAllVariants: () => void
    loadEnvironments: () => Promise<void>
    usernames: Record<string, string>
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
    environments,
    fetchAllVariants,
    loadEnvironments,
    usernames,
}: VariantsOverviewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [queryVariant, setQueryVariant] = useQueryParam("variant")
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectedVariant, setSelectedVariant] = useState<Variant>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeployVariantModalOpen, setIsDeployVariantModalOpen] = useState(false)
    const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false)

    const selectedVariantsToCompare = useMemo(() => {
        const variants = variantList.filter((variant) =>
            selectedRowKeys.includes(variant.variantId),
        )
        return {
            isCompareDisabled: variants.length !== 2,
            compareVariantList: variants,
        }
    }, [selectedRowKeys])

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const handleNavigation = useCallback(
        (variantName: string, revisionNum: number) => {
            router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
        },
        [appId, router],
    )

    const handleDeleteVariant = useCallback(
        async (variantId: string) => {
            try {
                if (
                    !(await checkIfResourceValidForDeletion({
                        resourceType: "variant",
                        resourceIds: [variantId],
                    }))
                )
                    return

                await deleteSingleVariant(variantId)
                message.success("Variant removed successfully!")
                fetchAllVariants()
            } catch (error) {
                console.error(error)
            }
        },
        [fetchAllVariants],
    )

    const columns = useMemo(() => {
        const columns: ColumnsType<Variant> = [
            {
                title: "Name",
                dataIndex: "variant_name",
                key: "variant_name",
                fixed: "left",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return <span>{record.variantName}</span>
                },
            },
            {
                title: "Last modified",
                dataIndex: "updatedAt",
                key: "updatedAt",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return <div>{record.updatedAt}</div>
                },
            },
        ]

        if (isDemo()) {
            columns.push({
                title: "Modified by",
                dataIndex: "modifiedById",
                key: "modifiedById",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return <div>{usernames[record.modifiedById]}</div>
                },
            })
        }

        columns.push(
            // {
            //     title: "Tags",
            //     onHeaderCell: () => ({
            //         style: {minWidth: 160},
            //     }),
            // },
            {
                title: "Model",
                dataIndex: "parameters",
                key: "model",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    const parameters =
                        (
                            (record.parameters?.ag_config as unknown as Record<string, unknown>)
                                ?.prompt as Record<string, unknown>
                        )?.llm_config || record.parameters
                    return parameters && Object.keys(parameters).length
                        ? Object.values(
                              filterVariantParameters({record: parameters, key: "model"}),
                          ).map((value, index) => (value ? <Tag key={index}>{value}</Tag> : "-"))
                        : "-"
                },
            },
            {
                title: "Created on",
                dataIndex: "createdAt",
                key: "createdAt",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return <div>{record.createdAt}</div>
                },
            },
            {
                title: <GearSix size={16} />,
                key: "key",
                width: 56,
                fixed: "right",
                align: "center",
                render: (_, record) => {
                    return (
                        <Dropdown
                            trigger={["click"]}
                            overlayStyle={{width: 180}}
                            menu={{
                                items: [
                                    {
                                        key: "details",
                                        label: "Open details",
                                        icon: <Note size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            setQueryVariant(record.variantId)
                                            setSelectedVariant(record)
                                        },
                                    },
                                    {
                                        key: "open_variant",
                                        label: "Open in playground",
                                        icon: <Rocket size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleNavigation(record.variantName, record.revision)
                                        },
                                    },
                                    {
                                        key: "deploy",
                                        label: "Deploy",
                                        icon: <CloudArrowUp size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            setIsDeployVariantModalOpen(true)
                                            setSelectedVariant(record)
                                        },
                                    },
                                    // {
                                    //     key: "clone",
                                    //     label: "Clone",
                                    //     icon: <Copy size={16} />,
                                    //     onClick: (e) => {
                                    //         e.domEvent.stopPropagation()
                                    //     },
                                    // },
                                    {type: "divider"},
                                    // {
                                    //     key: "rename",
                                    //     label: "Rename",
                                    //     icon: <PencilLine size={16} />,
                                    //     onClick: (e) => {
                                    //         e.domEvent.stopPropagation()

                                    //     },
                                    // },
                                    {
                                        key: "delete_eval",
                                        label: "Delete",
                                        icon: <Trash size={16} />,
                                        danger: true,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            setSelectedVariant(record)
                                            setIsDeleteEvalModalOpen(true)
                                        },
                                    },
                                ],
                            }}
                        >
                            <Button
                                onClick={(e) => e.stopPropagation()}
                                type="text"
                                icon={<MoreOutlined />}
                            />
                        </Dropdown>
                    )
                },
            },
        )

        return columns
    }, [handleNavigation, setQueryVariant, usernames])

    return (
        <>
            <div className={classes.container}>
                <div className="flex items-center justify-between">
                    <Title>Variants</Title>

                    <Space>
                        <Button
                            type="link"
                            disabled={selectedVariantsToCompare.isCompareDisabled}
                            icon={<SwapOutlined />}
                            onClick={() => setIsComparisonModalOpen(true)}
                        >
                            Compare variants
                        </Button>

                        <Button
                            icon={<Rocket size={14} className="mt-[3px]" />}
                            href={`/apps/${appId}/playground`}
                        >
                            Playground
                        </Button>
                    </Space>
                </div>

                <Spin spinning={isVariantLoading}>
                    <Table
                        rowSelection={{
                            type: "checkbox",
                            columnWidth: 48,
                            ...rowSelection,
                        }}
                        className="ph-no-capture"
                        rowKey={"variantId"}
                        columns={columns}
                        dataSource={variantList}
                        scroll={{x: true}}
                        bordered
                        pagination={false}
                        onRow={(record) => ({
                            style: {cursor: "pointer"},
                            onClick: () => {
                                setQueryVariant(record.variantId)
                                setSelectedVariant(record)
                            },
                        })}
                    />
                </Spin>
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
                    onOk={() => handleDeleteVariant(selectedVariant.variantId)}
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
                    environments={environments}
                    selectedVariant={selectedVariant}
                    loadEnvironments={loadEnvironments}
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
