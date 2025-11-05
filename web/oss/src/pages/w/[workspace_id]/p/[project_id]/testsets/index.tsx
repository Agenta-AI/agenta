import {useMemo, useState} from "react"

import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Copy, GearSix, Note, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Spin, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table/interface"
import dayjs from "dayjs"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import NoResultsFound from "@/oss/components/NoResultsFound/NoResultsFound"
import useURL from "@/oss/hooks/useURL"
import {formatDate} from "@/oss/lib/helpers/dateTimeHelper"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {JSSTheme, Testset, testset, TestsetCreationMode} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"
import {useTestsetsData} from "@/oss/state/testset"

const TestsetModal: any = dynamic(() => import("@/oss/components/pages/testset/modals"))
const DeleteTestsetModal: any = dynamic(
    () => import("@/oss/components/pages/testset/modals/DeleteTestset"),
)

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
    const {projectURL} = useURL()
    const {isLoading: isAppsLoading} = useAppsData()
    const [selectedRowKeys, setSelectedRowKeys] = useState<testset[]>([])
    const {testsets, isLoading: isTestsetsLoading, mutate} = useTestsetsData()
    const [isCreateTestsetModalOpen, setIsCreateTestsetModalOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [testsetCreationMode, setTestsetCreationMode] = useState<TestsetCreationMode>("create")
    const [editTestsetValues, setEditTestsetValues] = useState<testset | null>(null)
    const [current, setCurrent] = useState(0)
    const [selectedTestsetToDelete, setSelectedTestsetToDelete] = useState<testset[]>([])
    const [isDeleteTestsetModalOpen, setIsDeleteTestsetModalOpen] = useState(false)

    useBreadcrumbsEffect({breadcrumbs: {testsets: {label: "testsets"}}}, [])

    const filteredTestset = useMemo(() => {
        let allTestsets = testsets.sort(
            (a: Testset, b: Testset) =>
                dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf(),
        )
        if (searchTerm) {
            allTestsets = testsets.filter((item: Testset) =>
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
                                        router.push(`${projectURL}/testsets/${record._id}`)
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
                                {
                                    key: "copy-id",
                                    label: "Copy ID",
                                    icon: <Copy size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        copyToClipboard(record._id)
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
                    <Typography.Title level={4}>Testsets</Typography.Title>

                    <Button
                        type="primary"
                        icon={<PlusOutlined className="mt-[1px]" />}
                        onClick={() => setIsCreateTestsetModalOpen(true)}
                    >
                        Create new testset
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
                        disabled={!selectedRowKeys.length}
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
                    className={`ph-no-capture ${classes.table}`}
                    columns={columns}
                    dataSource={filteredTestset}
                    rowKey="_id"
                    loading={isTestsetsLoading || isAppsLoading}
                    scroll={{x: true}}
                    pagination={false}
                    onRow={(record) => {
                        return {
                            onClick: () => router.push(`${projectURL}/testsets/${record._id}`),
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
                        setSelectedRowKeys([])
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
