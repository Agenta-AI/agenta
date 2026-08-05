import {getWorkflowTypeColor} from "@agenta/entities/workflow"
import {Tag} from "antd"

interface EvaluatorTypeTagProps {
    label?: string
    typeKey?: string
}

const EvaluatorTypeTag = ({label, typeKey}: EvaluatorTypeTagProps) => {
    if (!label) return null
    const color = getWorkflowTypeColor(typeKey)?.name

    return (
        <Tag className="!m-0" bordered={false} color={color} style={{fontSize: 12}}>
            {label}
        </Tag>
    )
}

export default EvaluatorTypeTag
