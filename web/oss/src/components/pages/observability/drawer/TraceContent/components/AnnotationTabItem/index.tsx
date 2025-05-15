import type {TableProps} from "antd/es/table"
import {Badge, Button, Flex, Space, Table, Typography} from "antd"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {ChatText} from "@phosphor-icons/react"
import {MinusOutlined, PlusOutlined} from "@ant-design/icons"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/oss/lib/Types"
import UserAvatarTag from "@/oss/components/ui/UserAvatarTag"
import CustomAntdTag from "@/oss/components/ui/CustomAntdTag"
import {getAnnotationTableColumns} from "./assets/getAnnotationTableColumns"
import {v4 as uuidv4} from "uuid"
import clsx from "clsx"
import NoTraceAnnotations from "../../../TraceSidePanel/TraceAnnotations/components/NoTraceAnnotations"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    expandableTable: {
        "& .ant-table-cell": {
            backgroundColor: "#F5F7FA",
        },
    },
    table: {
        "& .ant-table-expanded-row > .ant-table-cell": {
            padding: 0,
        },
    },
}))

const AnnotationTabItem = ({annotations}: {annotations: AnnotationDto[]}) => {
    const classes = useStyles()

    const groupedByReference = annotations.reduce(
        (acc, item) => {
            const key = item.references?.evaluator?.slug || ""
            if (!acc[key]) {
                acc[key] = []
            }
            acc[key].push({
                ...item,
                id: uuidv4(), // Add unique ID here
            })
            return acc
        },
        {} as Record<string, AnnotationDto[]>,
    )

    const expandable: TableProps<AnnotationDto>["expandable"] = {
        expandedRowRender: (record) => (
            <div>
                <Table
                    columns={[
                        {
                            title: "User",
                            key: "user",
                            dataIndex: "user",
                            render: (_, record) => <div>{record.key}</div>,
                            width: 152,
                        },
                        {
                            title: "Note",
                            key: "text",
                            dataIndex: "text",
                            render: (_, record) => (
                                <div className="w-fit text-wrap">{record.value}</div>
                            ),
                        },
                    ]}
                    dataSource={Object.entries(record?.data?.outputs?.notes || {}).map(
                        ([key, value]) => ({
                            key,
                            value,
                        }),
                    )}
                    rowKey={(note, index) => `${note}-${index}`}
                    pagination={false}
                    bordered
                    showHeader={false}
                    size="small"
                    className={classes.expandableTable}
                />
            </div>
        ),
        expandIcon: ({expanded, onExpand, record}) => (
            <Flex align="center" gap={10}>
                <Button
                    size="small"
                    className="!w-[16px] !h-4 !p-0.5 !rounded-sm flex items-center justify-center"
                    icon={
                        expanded ? (
                            <MinusOutlined className="w-3 h-3 mt-0.5" />
                        ) : (
                            <PlusOutlined className="w-3 h-3 mt-0.5" />
                        )
                    }
                    onClick={(e) => onExpand(record, e)}
                />
                <div className="flex items-center gap-1.5">
                    <ChatText size={16} />
                    <Badge
                        count={Object.values(record?.data?.outputs?.notes || {}).length}
                        color="#000000"
                        className="[&_.ant-badge-count]:!rounded-[4px] [&_.ant-badge-count]:!h-[14px] [&_.ant-badge-count]:!min-w-[14px] [&_.ant-badge-count]:text-[10px] [&_.ant-badge-count]:!flex [&_.ant-badge-count]:items-center [&_.ant-badge-count]:justify-center"
                    />
                </div>
            </Flex>
        ),
        rowExpandable: (record) => Object.values(record?.data?.outputs?.notes || {}).length > 0,
        columnWidth: 100,
        fixed: "left",
    }

    return (
        <Space direction="vertical" size={16} className="w-full">
            {Object.entries(groupedByReference).length > 0 ? (
                Object.entries(groupedByReference).map(([reference, annotations]) => (
                    <Space direction="vertical" key={reference} className="w-full @container">
                        <Typography.Text>{reference}</Typography.Text>
                        <Table
                            columns={getAnnotationTableColumns(reference, annotations)}
                            pagination={false}
                            scroll={{x: "max-content"}}
                            bordered
                            expandable={expandable}
                            dataSource={annotations}
                            className={clsx(
                                "[&_.ant-table-expanded-row-fixed]:!w-[100cqw] [&_.ant-table-expanded-row-fixed]:!px-0 [&_.ant-table-expanded-row-fixed]:!sticky [&_.ant-table-expanded-row-fixed]:!left-0",
                                classes.table,
                            )}
                            rowKey="id"
                        />
                    </Space>
                ))
            ) : (
                <div className="grid place-items-center h-full p-8">
                    <NoTraceAnnotations />
                </div>
            )}
        </Space>
    )
}

export default AnnotationTabItem
