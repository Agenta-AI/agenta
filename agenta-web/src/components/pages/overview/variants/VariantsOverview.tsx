import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {MoreOutlined, SwapOutlined} from "@ant-design/icons"
import {CloudArrowUp, GearSix, Note, PencilLine, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, message, Space, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import Link from "next/link"
import {useRouter} from "next/router"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import VariantDrawer from "./VariantDrawer"
import {useQueryParam} from "@/hooks/useQuery"
import {filterVariantParameters, isDemo} from "@/lib/helpers/utils"
import {checkIfResourceValidForDeletion} from "@/lib/helpers/evaluate"
import {deleteSingleVariant} from "@/services/playground/api"
import DeleteEvaluationModal from "@/components/DeleteEvaluationModal/DeleteEvaluationModal"

const {Title} = Typography

interface VariantsOverviewProps {
    isVariantLoading: boolean
    variantList: Variant[]
    environments: Environment[]
    fetchAllVariants: () => void
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
    titleLink: {
        display: "flex",
        alignItems: "center",
        gap: theme.paddingXS,
        border: `1px solid ${theme.colorBorder}`,
        padding: "1px 7px",
        height: 24,
        borderRadius: theme.borderRadius,
        color: theme.colorText,
        "&:hover": {
            borderColor: theme.colorInfoBorderHover,
            transition: "all 0.2s cubic-bezier(0.645, 0.045, 0.355, 1)",
        },
    },
}))

const VariantsOverview = ({
    variantList,
    isVariantLoading,
    environments,
    fetchAllVariants,
}: VariantsOverviewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [queryVariant, setQueryVariant] = useQueryParam("variant")
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectedVariant, setSelectedVariant] = useState<Variant>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const handleNavigation = (variantName: string, revisionNum: number) => {
        router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const handleDeleteVariant = async (variantId: string) => {
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
    }

    const columns: ColumnsType<Variant> = [
        {
            title: "Name",
            dataIndex: "variant_name",
            key: "variant_name",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <span>{record.variantName}</span>
            },
        },
        {
            title: "Last modified",
            dataIndex: "lastModified",
            key: "lastModified",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <div>{record.lastModified}</div>
            },
        },
    ]

    if (isDemo()) {
        columns.push({
            title: "Modified by",
            dataIndex: "modifiedBy",
            key: "modifiedBy",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <div>{record.modifiedBy.username}</div>
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
                return record.parameters && Object.keys(record.parameters).length
                    ? Object.values(
                          filterVariantParameters({record: record.parameters, key: "model"}),
                      ).map((value, index) => <Tag key={index}>{value}</Tag>)
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
                                    },
                                },
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
                            size="small"
                        />
                    </Dropdown>
                )
            },
        },
    )

    return (
        <>
            <div className={classes.container}>
                <div className="flex items-center justify-between">
                    <Title>Variants</Title>

                    <Space>
                        <Button size="small" type="link" icon={<SwapOutlined />}>
                            Compare variants
                        </Button>
                        <Link href={`/apps/${appId}/playground`} className={classes.titleLink}>
                            <Rocket size={14} />
                            Playground
                        </Link>
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
                />
            )}

            {selectedVariant && (
                <DeleteEvaluationModal
                    open={isDeleteEvalModalOpen}
                    onCancel={() => setIsDeleteEvalModalOpen(false)}
                    onOk={async () => {
                        await handleDeleteVariant(selectedVariant.variantId)
                        setIsDeleteEvalModalOpen(false)
                        setQueryVariant("")
                    }}
                    evaluationType={variantNameWithRev({
                        variant_name: selectedVariant.variantName,
                        revision: selectedVariant.revision,
                    })}
                />
            )}
        </>
    )
}

export default VariantsOverview
