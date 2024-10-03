import TestsetModal from "@/components/pages/testset/modals"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {checkIfResourceValidForDeletion} from "@/lib/helpers/evaluate"
import {JSSTheme, testset} from "@/lib/Types"
import {deleteTestsets, useLoadTestsetsList} from "@/services/testsets/api"
import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Copy, GearSix, Note, PencilSimple, Trash} from "@phosphor-icons/react"
import {Avatar, Button, Dropdown, Input, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table/interface"
import {useRouter} from "next/router"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modal: {
        transition: "width 0.3s ease",
        "& .ant-modal-content": {
            overflow: "hidden",
            borderRadius: 16,
            "& > .ant-modal-close": {
                top: 16,
            },
        },
    },
    headingTest: {
        fontSize: theme.fontSizeHeading4,
        lineHeight: theme.lineHeightHeading4,
        fontWeight: theme.fontWeightMedium,
    },
    button: {
        display: "flex",
        alignItems: "center",
    },
}))

const Testset = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const {testsets, isTestsetsLoading, mutate} = useLoadTestsetsList(appId)
    const [isCreateTestsetModalOpen, setIsCreateTestsetModalOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const onDelete = async () => {
        const testsetsIds = selectedRowKeys.map((key) => key.toString())
        try {
            if (
                !(await checkIfResourceValidForDeletion({
                    resourceType: "testset",
                    resourceIds: testsetsIds,
                }))
            )
                return
            await deleteTestsets(testsetsIds)
            mutate()
            setSelectedRowKeys([])
        } catch {}
    }

    const filteredTestset = useMemo(() => {
        return testsets
            ? testsets.filter((item: any) =>
                  item.name.toLowerCase().includes(searchTerm.toLowerCase()),
              )
            : testsets
    }, [searchTerm, testsets])

    const columns: ColumnsType<testset> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: "Date Modified",
            dataIndex: "date_modified",
            key: "date_modified",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (date: string) => {
                return formatDate(date)
            },
        },
        {
            title: "Modified By",
            dataIndex: "modified_by",
            key: "modified_by",
            render: (date: string) => {
                return (
                    <div className="flex items-center gap-2">
                        <Avatar
                            className="w-4 h-4 text-[10px] flex items-center justify-center"
                            size="small"
                        >
                            A
                        </Avatar>
                        <Typography.Text>Username</Typography.Text>
                    </div>
                )
            },
        },
        {
            title: "Tags",
            dataIndex: "tags",
            key: "tags",
            onHeaderCell: () => ({
                style: {minWidth: 144},
            }),
            render: (date: string) => {
                return [1].map((tag) => <Tag>Defailt</Tag>)
            },
        },
        {
            title: "Date created",
            dataIndex: "date_created",
            key: "date_created",
            render: (date: string) => {
                return formatDate(date)
            },
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
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
                                    label: "View details",
                                    icon: <Note size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(
                                            `/apps/${appId}/evaluations/single_model_test/${record}`,
                                        )
                                    },
                                },
                                {
                                    key: "clone",
                                    label: "Clone",
                                    icon: <Copy size={16} />,
                                },
                                {type: "divider"},
                                {
                                    key: "rename",
                                    label: "Rename",
                                    icon: <PencilSimple size={16} />,
                                },
                                {
                                    key: "delete_eval",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
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
    ]

    return (
        <>
            <section className="w-full flex flex-col gap-4 mb-2">
                <div className="flex items-center justify-between">
                    <Typography.Title level={4} className={classes.headingTest}>
                        Test sets
                    </Typography.Title>

                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setIsCreateTestsetModalOpen(true)}
                    >
                        Create new test set
                    </Button>
                </div>
                <div className="flex items-center justify-between">
                    <Input.Search
                        placeholder="Search"
                        className="w-[400px]"
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <Button
                        danger
                        type="text"
                        icon={<Trash size={14} />}
                        className={classes.button}
                        disabled={selectedRowKeys.length == 0}
                        onClick={onDelete}
                    >
                        Delete
                    </Button>
                </div>
            </section>

            <Spin spinning={isTestsetsLoading}>
                <Table
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        ...rowSelection,
                    }}
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={filteredTestset}
                    rowKey="_id"
                    loading={isTestsetsLoading}
                    bordered
                    pagination={false}
                    onRow={(record) => {
                        return {
                            onClick: () => router.push(`/apps/${appId}/testsets/${record._id}`),
                        }
                    }}
                />
            </Spin>

            <TestsetModal
                open={isCreateTestsetModalOpen}
                onCancel={() => {
                    setIsCreateTestsetModalOpen(false)
                }}
            />
        </>
    )
}

export default Testset
