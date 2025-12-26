import {Tag} from "antd"

interface EvaluatorTypeTagProps {
    label?: string
    color?: string
    fallback?: {backgroundColor?: string; textColor?: string}
}

const EvaluatorTypeTag = ({label, color, fallback}: EvaluatorTypeTagProps) => {
    if (!label) return null
    const style =
        color == null
            ? {
                  fontSize: 12,
                  backgroundColor: fallback?.backgroundColor ?? "#EAEFF5",
                  color: fallback?.textColor ?? "#344054",
              }
            : {fontSize: 12}

    return (
        <Tag className="!m-0" variant="filled" color={color} style={style}>
            {label}
        </Tag>
    )
}

export default EvaluatorTypeTag
