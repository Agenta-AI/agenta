import {Variant} from "@/lib/Types"
import {Card} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    root: {
        flex: 1,
        "& .ant-card-cover": {
            padding: "0.5rem",
            "& img": {
                maxHeight: 300,
                width: "100%",
                objectFit: "contain",
            },
        },
        "& .ant-card-meta-description": {
            whiteSpace: "pre-line",
            position: "relative",
            maxHeight: 300,
            overflow: "auto",
        },
    },
})

type Props = {
    variant: Variant
    outputText?: string
    outputImg?: string
}

const EvaluationVariantCard: React.FC<Props> = ({variant, outputText, outputImg}) => {
    const classes = useStyles()

    return (
        <Card className={classes.root} cover={outputImg && <img alt="output" src={outputImg} />}>
            <Card.Meta
                title={variant.variantName}
                description={outputText || <em>Click the "Run" icon to get variant output</em>}
            />
        </Card>
    )
}

export default EvaluationVariantCard
