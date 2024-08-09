import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {JSSTheme, Variant} from "@/lib/Types"
import {MoreOutlined, SwapOutlined} from "@ant-design/icons"
import {CloudArrowUp, GearSix, Note, PencilLine, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Spin, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import Link from "next/link"
import {useRouter} from "next/router"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"

const {Title} = Typography

interface VariantsOverviewProps {
    isVariantLoading: boolean
    variantList: Variant[]
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
const VariantsOverview = ({variantList, isVariantLoading}: VariantsOverviewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const handleNavigation = (variantName: string, revisionNum: number) => {
        router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const handleDeleteEvaluation = async (record: Variant) => {}

    const columns: ColumnsType<Variant> = [
        {
            title: "Name",
            dataIndex: "variant_name",
            key: "variant_name",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return (
                    <span>
                        {variantNameWithRev({
                            variant_name: record.variantName,
                            revision: record.revision,
                        })}
                    </span>
                )
            },
        },
        {
            title: "Last modified",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: "Modified by",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: "Tags",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: "Model",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: "Created on",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: <GearSix size={16} />,
            key: "key",
            width: 56,
            fixed: "right",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                {
                                    key: "details",
                                    label: "Open details",
                                    icon: <Note size={16} />,
                                },
                                {
                                    key: "open_variant",
                                    label: "Open in playground",
                                    icon: <Rocket size={16} />,
                                    onClick: () =>
                                        handleNavigation(record.variantName, record.revision),
                                },
                                {
                                    key: "deploy",
                                    label: "Deploy",
                                    icon: <CloudArrowUp size={16} />,
                                },
                                {type: "divider"},
                                {
                                    key: "rename",
                                    label: "Rename",
                                    icon: <PencilLine size={16} />,
                                },
                                {
                                    key: "delete_eval",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: () => handleDeleteEvaluation(record),
                                },
                            ],
                        }}
                    >
                        <Button type="text" icon={<MoreOutlined />} size="small" />
                    </Dropdown>
                )
            },
        },
    ]

    return (
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
                />
            </Spin>
        </div>
    )
}

export default VariantsOverview
