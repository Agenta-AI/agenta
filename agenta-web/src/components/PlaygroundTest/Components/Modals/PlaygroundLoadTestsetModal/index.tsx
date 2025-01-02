import {useEffect, useMemo, useState} from "react"
import {TestSet, testset} from "@/lib/Types"
import {fetchTestset, useLoadTestsetsList} from "@/services/testsets/api"
import {Play} from "@phosphor-icons/react"
import {Divider, Input, Menu, Modal, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {PlaygroundLoadTestsetModalProps} from "./types"
import {useStyles} from "./styles"

const PlaygroundLoadTestsetModal: React.FC<PlaygroundLoadTestsetModalProps> = ({
    testsetData,
    setTestsetData,
    ...props
}) => {
    const classes = useStyles()
    const {testsets} = useLoadTestsetsList()
    const [isLoadingTestset, setIsLoadingTestset] = useState(false)
    const [selectedTestset, setSelectedTestset] = useState(testsets[0]?._id)
    const [testsetCsvData, setTestsetCsvData] = useState<TestSet["csvdata"][]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [searchTerm, setSearchTerm] = useState("")

    useEffect(() => {
        testsetFetcher()
    }, [selectedTestset])

    const filteredTestset = useMemo(() => {
        if (!searchTerm) return testsets
        return testsets.filter((item: testset) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, testsets])

    const testsetFetcher = async () => {
        try {
            setIsLoadingTestset(true)
            const data = await fetchTestset(selectedTestset)
            setTestsetCsvData(data.csvdata)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoadingTestset(false)
        }
    }

    const rowSelection = {
        selectedRowKeys,
        onChange: (keys: React.Key[]) => {
            setSelectedRowKeys(keys)
        },
    }

    const onClose = () => {
        props.onCancel?.({} as any)
    }

    const loadTestCase = () => {
        const selectedTestCase = testsetCsvData.find((_, index) => index === selectedRowKeys[0])

        if (selectedTestCase) {
            setTestsetData(selectedTestCase)
            onClose()
        }
    }

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
            title="Load Test set"
            okText="Load test set"
            okButtonProps={{
                icon: <Play />,
                iconPosition: "end",
                disabled: !selectedRowKeys.length,
                onClick: loadTestCase,
                loading: isLoadingTestset,
            }}
            {...props}
        >
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
                        onSelect={({key}) => {
                            setSelectedTestset(key)
                            setSelectedRowKeys([])
                        }}
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
                        rowSelection={{type: "checkbox", ...rowSelection}}
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
                                    setSelectedRowKeys([rowIndex])
                                }
                            },
                        })}
                    />
                </div>
            </div>
        </Modal>
    )
}

export default PlaygroundLoadTestsetModal
