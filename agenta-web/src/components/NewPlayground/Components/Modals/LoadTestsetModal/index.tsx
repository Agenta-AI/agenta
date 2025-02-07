import {useCallback, useEffect, useMemo, useState} from "react"
import {TestSet, testset} from "@/lib/Types"
import {fetchTestset, useLoadTestsetsList} from "@/services/testsets/api"
import {Play} from "@phosphor-icons/react"
import {Divider, Input, Menu, Modal, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {LoadTestsetModalProps} from "./types"
import {useStyles} from "./styles"
import NoResultsFound from "@/components/NoResultsFound/NoResultsFound"

const LoadTestsetModal: React.FC<LoadTestsetModalProps> = ({
    testsetData,
    setTestsetData,
    isChat = false,
    ...props
}) => {
    const classes = useStyles()
    const {testsets} = useLoadTestsetsList()
    const [isLoadingTestset, setIsLoadingTestset] = useState(false)
    const [selectedTestset, setSelectedTestset] = useState("")
    const [testsetCsvData, setTestsetCsvData] = useState<TestSet["csvdata"][]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [searchTerm, setSearchTerm] = useState("")

    const testsetFetcher = useCallback(
        async (testsetId: string) => {
            try {
                setIsLoadingTestset(true)
                const data = await fetchTestset(testsetId)
                setTestsetCsvData(data.csvdata)
            } catch (error) {
                console.error(error)
            } finally {
                setIsLoadingTestset(false)
            }
        },
        [fetchTestset, setTestsetCsvData],
    )

    useEffect(() => {
        if (testsets.length > 0 && !selectedTestset.trim()) {
            const firstTestsetId = testsets[0]?._id
            setSelectedTestset(firstTestsetId)
            testsetFetcher(firstTestsetId)
        }
    }, [testsets])

    const filteredTestset = useMemo(() => {
        if (!searchTerm) return testsets
        return testsets.filter((item: testset) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, testsets])

    const rowSelection = useMemo(
        () => ({
            selectedRowKeys,
            onChange: (keys: React.Key[]) => {
                setSelectedRowKeys(keys)
            },
        }),
        [selectedRowKeys],
    )

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
        setSelectedRowKeys([])
    }, [])

    const loadTestset = useCallback(() => {
        const selectedTestCase = testsetCsvData.filter((_, index) =>
            selectedRowKeys.includes(index),
        )
        if (selectedTestCase) {
            setTestsetData(selectedTestCase)
            onClose()
        }
    }, [selectedRowKeys])

    const onChangeTestset = useCallback(
        ({key}: any) => {
            setSelectedRowKeys([])
            testsetFetcher(key)
            setSelectedTestset(key)
        },
        [testsetFetcher],
    )

    const columnDef = useMemo(() => {
        const columns: ColumnsType<TestSet["csvdata"]> = []

        if (testsetCsvData.length > 0) {
            const keys = Object.keys(testsetCsvData[0])

            columns.push(
                ...keys.map((key, index) => ({
                    title: key,
                    dataIndex: key,
                    key: index,
                    width: 300,
                    onHeaderCell: () => ({
                        style: {minWidth: 160},
                    }),
                    render: (_: any, record: any) => {
                        return <div>{record[key]}</div>
                    },
                })),
            )
        }

        return columns
    }, [testsetCsvData])

    return (
        <Modal
            centered
            width={1150}
            className={classes.container}
            afterClose={() => setSelectedRowKeys([])}
            title="Load test set"
            okText="Load test set"
            okButtonProps={{
                icon: <Play />,
                iconPosition: "end",
                disabled: !selectedRowKeys.length,
                onClick: loadTestset,
                loading: isLoadingTestset,
            }}
            {...props}
        >
            {!testsets.length ? (
                <NoResultsFound />
            ) : (
                <div className="flex gap-4 flex-1 mt-4">
                    <div className={classes.sidebar}>
                        <Input.Search
                            placeholder="Search"
                            allowClear
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />

                        <Divider className="m-0" />

                        <Menu
                            items={filteredTestset.map((testset: testset) => ({
                                key: testset._id,
                                label: testset.name,
                            }))}
                            onSelect={onChangeTestset}
                            defaultSelectedKeys={[selectedTestset]}
                            className={classes.menu}
                        />
                    </div>

                    <Divider type="vertical" className="m-0 h-full" />

                    <div className="flex flex-col gap-4 flex-1 overflow-x-auto">
                        <Typography.Text className={classes.subTitle}>
                            Select a testcase
                        </Typography.Text>

                        <Table
                            rowSelection={{type: isChat ? "radio" : "checkbox", ...rowSelection}}
                            loading={isLoadingTestset}
                            dataSource={testsetCsvData.map((data, index) => ({...data, id: index}))}
                            columns={columnDef}
                            className="flex-1"
                            bordered
                            rowKey={"id"}
                            pagination={false}
                            scroll={{y: 500, x: "max-content"}}
                            onRow={(_, rowIndex) => ({
                                className: "cursor-pointer",
                                onClick: () => {
                                    if (rowIndex !== undefined) {
                                        if (selectedRowKeys.includes(rowIndex)) {
                                            setSelectedRowKeys(
                                                selectedRowKeys.filter((row) => row !== rowIndex),
                                            )
                                        } else {
                                            if (isChat) {
                                                setSelectedRowKeys([rowIndex])
                                            } else {
                                                setSelectedRowKeys([...selectedRowKeys, rowIndex])
                                            }
                                        }
                                    }
                                },
                            })}
                        />
                    </div>
                </div>
            )}
        </Modal>
    )
}

export default LoadTestsetModal
