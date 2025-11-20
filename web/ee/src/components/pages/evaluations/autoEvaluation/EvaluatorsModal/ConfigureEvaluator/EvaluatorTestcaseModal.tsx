import {useEffect, useMemo, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Play} from "@phosphor-icons/react"
import {Button, Divider, Input, Menu, Modal, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"

import {TestSet} from "@/oss/lib/Types"
import {fetchTestset} from "@/oss/services/testsets/api"

import {useEvaluatorTestcaseModalStyles as useStyles} from "./assets/styles"
import {EvaluatorTestcaseModalProps} from "./types"

const EvaluatorTestcaseModal = ({
    testsets,
    setSelectedTestcase,
    selectedTestset,
    setSelectedTestset,
    ...props
}: EvaluatorTestcaseModalProps) => {
    const classes = useStyles()
    const [isLoadingTestset, setIsLoadingTestset] = useState(false)
    const [testsetCsvData, setTestsetCsvData] = useState<TestSet["csvdata"]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [searchTerm, setSearchTerm] = useState("")

    const filteredTestset = useMemo(() => {
        if (!searchTerm) return testsets
        return testsets.filter((item) => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    }, [searchTerm, testsets])

    useEffect(() => {
        const testsetFetcher = async () => {
            try {
                setIsLoadingTestset(true)
                const data = await fetchTestset(selectedTestset)
                if (data) {
                    setTestsetCsvData(data.csvdata)
                }
            } catch (error) {
                console.error(error)
            } finally {
                setIsLoadingTestset(false)
            }
        }

        testsetFetcher()
    }, [selectedTestset])

    type TestcaseRow = Record<string, any> & {id: number}
    const columnDef = useMemo(() => {
        const columns: ColumnsType<TestcaseRow> = []

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
                    render: (_: any, record: TestcaseRow) => {
                        return <div>{record[key]}</div>
                    },
                })),
            )
        }

        return columns
    }, [testsetCsvData])

    const rowSelection = {
        selectedRowKeys,
        onChange: (keys: React.Key[]) => {
            setSelectedRowKeys(keys)
        },
    }

    const loadTestCase = () => {
        const selectedTestCase = testsetCsvData.find((_, index) => index === selectedRowKeys[0])

        if (selectedTestCase) {
            setSelectedTestcase({testcase: selectedTestCase})
            props.onCancel?.({} as any)
        }
    }

    return (
        <Modal
            centered
            width={1150}
            closeIcon={null}
            okText="Load test case"
            okButtonProps={{
                icon: <Play />,
                iconPosition: "end",
                disabled: !selectedRowKeys.length,
                onClick: loadTestCase,
                loading: isLoadingTestset,
            }}
            className={classes.container}
            title={
                <div className="flex items-center justify-between">
                    <Typography.Text className={classes.title}>Load Testcase</Typography.Text>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                </div>
            }
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
                        items={filteredTestset.map((testset) => ({
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
                        rowSelection={{type: "radio", ...rowSelection}}
                        loading={isLoadingTestset}
                        dataSource={testsetCsvData.map(
                            (data, index) => ({...data, id: index}) as TestcaseRow,
                        )}
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

export default EvaluatorTestcaseModal
