import {JSSTheme, TestSet, testset} from "@/lib/Types"
import {fetchTestset} from "@/services/testsets/api"
import {CloseOutlined} from "@ant-design/icons"
import {Button, Divider, Input, Menu, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

interface TestcaseTabProps {
    handleOnCancel: () => void
    setSelectedTestcase: React.Dispatch<React.SetStateAction<Record<string, any> | null>>
    testsets: testset[]
    selectedTestcase: Record<string, any> | null
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& .ant-typography": {
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
            lineHeight: theme.lineHeightLG,
        },
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
    },
    sidebar: {
        display: "flex",
        flexDirection: "column",
        gap: theme.padding,
        width: 213,
    },
    menu: {
        height: 550,
        overflowY: "auto",
        borderInlineEnd: `0px !important`,
    },
}))

const TestcaseTab = ({
    handleOnCancel,
    setSelectedTestcase,
    testsets,
    selectedTestcase,
}: TestcaseTabProps) => {
    const classes = useStyles()
    const [selectedTestset, setSelectedTestset] = useState(testsets[0]._id)
    const [isLoadingTestset, setIsLoadingTestset] = useState(false)
    const [testsetCsvData, setTestsetCsvData] = useState<TestSet["csvdata"][]>([])

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
                setTestsetCsvData(data.csvdata)
            } catch (error) {
                console.error(error)
            } finally {
                setIsLoadingTestset(false)
            }
        }

        testsetFetcher()
    }, [selectedTestset])

    const columnDef = useMemo(() => {
        const columns: ColumnsType<TestSet["csvdata"]> = []

        if (testsetCsvData.length > 0) {
            const keys = Object.keys(testsetCsvData[0])

            columns.push(
                ...keys.map((key, index) => ({
                    title: key,
                    dataIndex: key,
                    key: index,
                    render: (_: any, record: any) => {
                        return <div>{record[key]}</div>
                    },
                })),
            )
        }

        return columns
    }, [testsetCsvData])

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className={classes.header}>
                <Typography.Text>Select test case</Typography.Text>

                <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
            </div>
            <div className="flex gap-4 flex-1">
                <div className={classes.sidebar}>
                    <div className="flex flex-col gap-1">
                        <Typography.Text className={classes.title}>
                            Select test case
                        </Typography.Text>
                        <Typography.Text type="secondary">
                            Lorem ipsum, dolor sit amet consectetur adipisicing elit. Itaque culpa
                            similique reiciendis
                        </Typography.Text>
                    </div>
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
                        }}
                        defaultSelectedKeys={[selectedTestset]}
                        className={classes.menu}
                    />
                </div>
                <Divider type="vertical" className="m-0 h-full" />
                <div className="flex flex-col gap-4 flex-1">
                    <Typography.Text className={classes.title}>Select test cases</Typography.Text>

                    <Table
                        rowSelection={{
                            type: "radio",
                            onChange: (_, selectedRows) => {
                                setSelectedTestcase(selectedRows[0])
                            },
                        }}
                        loading={isLoadingTestset}
                        dataSource={testsetCsvData.map((data, index) => ({...data, id: index}))}
                        columns={columnDef}
                        className="flex-1"
                        bordered
                        rowKey={"id"}
                        pagination={false}
                        scroll={{y: 550}}
                    />

                    <div className="flex items-center justify-end gap-2">
                        <Button
                            onClick={() => {
                                handleOnCancel()
                                setSelectedTestcase(null)
                            }}
                        >
                            Close
                        </Button>
                        <Button
                            type="primary"
                            disabled={!selectedTestcase}
                            onClick={handleOnCancel}
                        >
                            Load test case
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default TestcaseTab
