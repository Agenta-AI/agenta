import {Evaluator, JSSTheme} from "@/lib/Types"
import {ArrowRight} from "@phosphor-icons/react"
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
        flex: 1,
        flexDirection: "column",
        "& .ant-typography:nth-of-type(1)": {
            fontSize: theme.fontSize,
            lineHeight: theme.lineHeight,
        },
    },
    arrowIcon: {
        opacity: 0,
        transition: "opacity 0.3s",
    },
    evaluatorCardHover: {
        "&:hover $arrowIcon": {
            opacity: 1,
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
            width: 200,
            render: (_, record) => {
                return (
                    <div className="h-[56px] flex items-center ">
                        <Tag color={record.color}>{record.name}</Tag>
                    </div>
                )
            },
        },
        {
            title: "Type",
            dataIndex: "description",
            key: "description",
            render: (_, record) => {
                return (
                    <div className="flex items-center gap-2">
                        <div className={classes.textDescription}>
                            <Typography.Text>{record.name}</Typography.Text>
                            <Typography.Text type="secondary">{record.description}</Typography.Text>
                        </div>
                        <ArrowRight className={classes.arrowIcon} size={14} />
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
            style={{cursor: "pointer"}}
            onRow={(record) => ({
                "data-cy": "new-evaluator-list",
                className: classes.evaluatorCardHover,
                onClick: () => {
                    setSelectedEvaluator(record)
                    setCurrent(2)
                },
            })}
        />
    )
}

export default CreateEvaluatorList
