import {Evaluator, JSSTheme} from "@/lib/Types"
import {Card, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

interface CreateEvaluatorCardProps {
    evaluators: Evaluator[]
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setCurrent: (value: React.SetStateAction<number>) => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingLG,
        overflowY: "auto",
        height: 600,
    },
    cardTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    evaluatorCard: {
        width: 276,
        display: "flex",
        flexDirection: "column",
        transition: "all 0.025s ease-in",
        cursor: "pointer",
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,

            "& .ant-card-head-title": {
                fontSize: theme.fontSize,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeight,
            },
        },
        "& > .ant-card-body": {
            height: 122,
            overflowY: "auto",
            padding: theme.paddingSM,
            "& .ant-typography": {
                color: theme.colorTextSecondary,
            },
        },
        "&:hover": {},
    },
}))

const CreateEvaluatorCard = ({
    evaluators,
    setSelectedEvaluator,
    setCurrent,
}: CreateEvaluatorCardProps) => {
    const classes = useStyles()

    return (
        <div className={classes.container}>
            <div className="flex flex-col gap-2">
                <Typography.Text className={classes.cardTitle}>Evaluator Title</Typography.Text>
                <div className="flex gap-4 flex-wrap">
                    {evaluators.map((evaluator) => (
                        <Card
                            key={evaluator.key}
                            className={classes.evaluatorCard}
                            title={evaluator.name}
                            onClick={() => {
                                setSelectedEvaluator(evaluator)
                                setCurrent(2)
                            }}
                        >
                            <Typography.Text>{evaluator.description}</Typography.Text>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default CreateEvaluatorCard
