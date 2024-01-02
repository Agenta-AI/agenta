import React from "react"
import {EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {DeleteOutlined, EditOutlined} from "@ant-design/icons"
import {Card, Tag, Typography} from "antd"
import {createUseStyles} from "react-jss"
import dayjs from "dayjs"
import Image from "next/image"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {deleteEvaluatorConfig} from "@/services/evaluations"
import {useAtom} from "jotai"
import {evaluatorsAtom} from "@/lib/atoms/evaluation"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        "& .ant-card-body": {
            padding: "1.25rem 0.75rem 1rem 1rem",
        },
    },
    body: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        alignSelf: "stretch",
        justifyContent: "space-between",
        marginBottom: "1.5rem",
    },
    evaluationImg: {
        width: 32,
        height: 32,
        marginRight: "8px",
        filter: theme.isDark ? "invert(1)" : "none",
    },
    name: {
        marginTop: "0.5rem",
        marginBottom: "0 !important",
        fontWeight: "500 !important",
        fontSize: "1rem",
    },
    date: {
        fontSize: "0.75rem",
        color: "#8c8c8c",
    },
}))

interface Props {
    evaluatorConfig: EvaluatorConfig
    onEdit?: () => void
    onSuccessDelete?: () => void
}

const EvaluatorCard: React.FC<Props> = ({evaluatorConfig, onEdit, onSuccessDelete}) => {
    const classes = useStyles()
    const [evaluators] = useAtom(evaluatorsAtom)
    const evaluator = evaluators.find((item) => item.key === evaluatorConfig.evaluator_key)!

    const onDelete = () => {
        AlertPopup({
            title: "Delete evaluator",
            message: "Are you sure you want to delete this evaluator?",
            onOk: () =>
                deleteEvaluatorConfig(evaluatorConfig.id)
                    .then(onSuccessDelete)
                    .catch(console.error),
        })
    }

    return (
        <Card
            className={classes.card}
            actions={
                evaluator.direct_use
                    ? []
                    : [
                          <EditOutlined key="edit" onClick={onEdit} />,
                          <DeleteOutlined key="delete" onClick={onDelete} />,
                      ]
            }
        >
            <div className={classes.body}>
                <div className={classes.headerRow}>
                    <Typography.Text className={classes.date}>
                        {dayjs(evaluatorConfig.created_at).format("DD MMM YY")}
                    </Typography.Text>
                    <Tag color={evaluator.color}>{evaluator.name}</Tag>
                </div>

                {evaluator.icon_url && (
                    <Image
                        src={evaluator.icon_url}
                        alt="Exact match"
                        className={classes.evaluationImg}
                    />
                )}

                <Typography.Title className={classes.name} level={4}>
                    {evaluatorConfig.name}
                </Typography.Title>
            </div>
        </Card>
    )
}

export default EvaluatorCard
