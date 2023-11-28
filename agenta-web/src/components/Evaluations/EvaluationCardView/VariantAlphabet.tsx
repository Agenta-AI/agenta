import {Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import {VARIANT_COLORS} from "."

type StyleProps = {
    color: string
    width: number
}

const useStyles = createUseStyles({
    variantType: {
        borderRadius: "50%",
        border: `1.5px solid`,
        borderColor: ({color}: StyleProps) => color,
        width: ({width}: StyleProps) => width,
        aspectRatio: "1/1",
        display: "inline-flex",
        justifyContent: "center",
        alignItems: "center",
        "& .ant-typography": {
            fontSize: ({width}: StyleProps) => width / 1.75,
            color: ({color}: StyleProps) => color,
        },
    },
})

interface Props {
    index: number
    width?: number
}

const VariantAlphabet: React.FC<Props> = ({index, width = 28}) => {
    const color = VARIANT_COLORS[index]
    const classes = useStyles({width, color} as StyleProps)

    return (
        <div className={classes.variantType}>
            <Typography.Text strong>{String.fromCharCode(65 + index)}</Typography.Text>
        </div>
    )
}

export default VariantAlphabet
