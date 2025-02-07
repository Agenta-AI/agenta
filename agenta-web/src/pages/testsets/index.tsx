import {useMemo, useState} from "react"
import NoResultsFound from "@/components/NoResultsFound/NoResultsFound"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {JSSTheme, TestSet, testset, TestsetCreationMode} from "@/lib/Types"
import {useLoadTestsetsList} from "@/services/testsets/api"
import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Copy, GearSix, Note, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Spin, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table/interface"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import dayjs from "dayjs"
import {useAppsData} from "@/contexts/app.context"
import {dynamicComponent} from "@/lib/helpers/dynamic"

const TestsetModal: any = dynamicComponent("pages/testset/modals")
const DeleteTestsetModal: any = dynamicComponent("pages/testset/modals/DeleteTestset")

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
    headerText: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& > .ant-typography": {
            fontSize: theme.fontSizeHeading4,
            lineHeight: theme.lineHeightHeading4,
            fontWeight: theme.fontWeightMedium,
            margin: 0,
        },
    },
    button: {
        display: "flex",
        alignItems: "center",
    },
    table: {
        "& table": {
            border: "1px solid",
            borderColor: theme.colorBorderSecondary,
        },
        "& .ant-table-expanded-row-fixed": {
            width: "100% !important",
        },
    },
}))

const Testset = () => {
    const classes = useStyles()
    const router = useRouter()
    const {isLoading: isAppsLoading} = useAppsData()
    const [selectedRowKeys, setSelectedRowKeys] = useState<testset[]>([])
    const {testsets, isTestsetsLoading, mutate} = useLoadTestsetsList()
    const [isCreateTestsetModalOpen, setIsCreateTestsetModalOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [testsetCreationMode, setTestsetCreationMode] = useState<TestsetCreationMode>("create")
    const [editTestsetValues, setEditTestsetValues] = useState<testset | null>(null)
    const [current, setCurrent] = useState(0)
    const [selectedTestsetToDelete, setSelectedTestsetToDelete] = useState<testset[]>([])
    const [isDeleteTestsetModalOpen, setIsDeleteTestsetModalOpen] = useState(false)

    const filteredTestset = useMemo(() => {
        let allTestsets = testsets.sort(
            (a: TestSet, b: TestSet) =>
                dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf(),
        )
        if (searchTerm) {
            allTestsets = testsets.filter((item: TestSet) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
        return allTestsets
    }, [searchTerm, testsets])

    const columns: ColumnsType<testset> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            onHeaderCell: () => ({
                style: {minWidth: 220},
            }),
        },
        {
            title: "Date Modified",
            dataIndex: "updated_at",
            key: "updated_at",
            onHeaderCell: () => ({
                style: {minWidth: 220},
            }),
            render: (date: string) => {
                return formatDate(date)
            },
        },
        {
            title: "Date created",
            dataIndex: "created_at",
            key: "created_at",
            render: (date: string) => {
                return formatDate(date)
            },
            onHeaderCell: () => ({
                style: {minWidth: 220},
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
                                        router.push(`/testsets/${record._id}`)
                                    },
                                },
                                {
                                    key: "clone",
                                    label: "Clone",
                                    icon: <Copy size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        setTestsetCreationMode("clone")
                                        setEditTestsetValues(record)
                                        setCurrent(1)
                                        setIsCreateTestsetModalOpen(true)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "rename",
                                    label: "Rename",
                                    icon: <PencilSimple size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        setTestsetCreationMode("rename")
                                        setEditTestsetValues(record)
                                        setCurrent(1)
                                        setIsCreateTestsetModalOpen(true)
                                    },
                                },
                                {
                                    key: "delete",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedTestsetToDelete([record])
                                        setIsDeleteTestsetModalOpen(true)
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
    ]

    return (
        <>
            <section className="w-full flex flex-col gap-6 mb-2">
                <div className={classes.headerText}>
                    <Typography.Title level={4}>Test sets</Typography.Title>

                    <Button
                        type="primary"
                        icon={<PlusOutlined className="mt-[1px]" />}
                        onClick={() => setIsCreateTestsetModalOpen(true)}
                        data-cy="create-testset-modal-button"
                    >
                        Create new test set
                    </Button>
                </div>
                <div className="flex items-center justify-between">
                    <Input.Search
                        allowClear
                        placeholder="Search"
                        className="w-[400px]"
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <Button
                        danger
                        type="text"
                        icon={<Trash size={14} className="mt-0.5" />}
                        className={classes.button}
                        disabled={selectedRowKeys.length == 0}
                        onClick={() => {
                            setSelectedTestsetToDelete(selectedRowKeys)
                            setIsDeleteTestsetModalOpen(true)
                        }}
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
                        onChange: (_, selectedRows) => {
                            setSelectedRowKeys(selectedRows)
                        },
                    }}
                    data-cy="app-testset-list"
                    className={`ph-no-capture ${classes.table}`}
                    columns={columns}
                    dataSource={filteredTestset}
                    rowKey="_id"
                    loading={isTestsetsLoading || isAppsLoading}
                    scroll={{x: true}}
                    pagination={false}
                    onRow={(record) => {
                        return {
                            onClick: () => router.push(`/testsets/${record._id}`),
                            style: {cursor: "pointer"},
                        }
                    }}
                    locale={{emptyText: <NoResultsFound />}}
                />
            </Spin>

            {selectedTestsetToDelete.length > 0 && (
                <DeleteTestsetModal
                    selectedTestsetToDelete={selectedTestsetToDelete}
                    mutate={mutate}
                    setSelectedTestsetToDelete={setSelectedTestsetToDelete}
                    open={isDeleteTestsetModalOpen}
                    onCancel={() => {
                        setIsDeleteTestsetModalOpen(false)
                    }}
                />
            )}

            <TestsetModal
                editTestsetValues={editTestsetValues}
                setEditTestsetValues={setEditTestsetValues}
                current={current}
                setCurrent={setCurrent}
                testsetCreationMode={testsetCreationMode}
                setTestsetCreationMode={setTestsetCreationMode}
                open={isCreateTestsetModalOpen}
                onCancel={() => {
                    setIsCreateTestsetModalOpen(false)
                }}
            />
        </>
    )
}

export default Testset
