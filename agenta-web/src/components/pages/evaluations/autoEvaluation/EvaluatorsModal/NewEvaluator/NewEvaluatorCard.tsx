import {Evaluator, JSSTheme} from "@/lib/Types"
import {ArrowRightOutlined} from "@ant-design/icons"
import {ArrowRight} from "@phosphor-icons/react"
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
        position: "relative",
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,

            "& .ant-card-head-title": {
                fontSize: theme.fontSize,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeight,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
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
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
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
                        className={`${classes.evaluatorCard} ${classes.evaluatorCardHover}`}
                        title={
                            <>
                                {evaluator.name}
                                <ArrowRight className={classes.arrowIcon} size={14} />
                            </>
                        }
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
