import {Evaluator, JSSTheme} from "@/lib/Types"
import {Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import React from "react"
import {createUseStyles} from "react-jss"

interface CreateEvaluatorListProps {
    evaluators: Evaluator[]
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setCurrent: (value: React.SetStateAction<number>) => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    textDescription: {
        display: "flex",
        flexDirection: "column",
        "& .ant-typography:nth-of-type(1)": {
            fontSize: theme.fontSize,
            lineHeight: theme.lineHeight,
        },
    },
}))

const CreateEvaluatorList = ({
    evaluators,
    setSelectedEvaluator,
    setCurrent,
}: CreateEvaluatorListProps) => {
    const classes = useStyles()

    const columns: ColumnsType<Evaluator> = [
        {
            title: "Category",
            dataIndex: "key",
            key: "key",
            width: 160,
            render: (_, record) => {
                return (
                    <div className="h-[56px] flex items-center ">
                        <Tag>{record.key}</Tag>
                    </div>
                )
            },
        },
        {
            title: "Type",
            dataIndex: "description",
            key: "description",
            width: "100%",
            render: (_, record) => {
                return (
                    <div className={classes.textDescription}>
                        <Typography.Text>{record.name}</Typography.Text>
                        <Typography.Text type="secondary">{record.description}</Typography.Text>
                    </div>
                )
            },
        },
    ]
    return (
        <Table
            columns={columns}
            dataSource={evaluators}
            bordered
            rowKey={"key"}
            className="ph-no-capture"
            scroll={{x: true, y: 550}}
            onRow={(record) => ({
                onClick: () => {
                    setSelectedEvaluator(record)
                    setCurrent(2)
                },
            })}
        />
    )
}

export default CreateEvaluatorList
