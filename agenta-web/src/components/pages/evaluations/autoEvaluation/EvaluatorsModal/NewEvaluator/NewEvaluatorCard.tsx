import {Evaluator, JSSTheme} from "@/lib/Types"
import {Card, Empty, Typography} from "antd"
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
        flexWrap: "wrap",
        gap: theme.padding,
        height: "100%",
        maxHeight: 600,
        overflowY: "auto",
    },
    cardTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    evaluatorCard: {
        flexDirection: "column",
        width: 276,
        display: "flex",
        height: "fit-content",
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
    centeredItem: {
        display: "grid",
        placeItems: "center",
        width: "100%",
        height: 600,
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
            {evaluators.length ? (
                evaluators.map((evaluator) => (
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
                ))
            ) : (
                <div className={classes.centeredItem}>
                    <Empty description="Evaluator not found" />
                </div>
            )}
        </div>
    )
}

export default CreateEvaluatorCard
