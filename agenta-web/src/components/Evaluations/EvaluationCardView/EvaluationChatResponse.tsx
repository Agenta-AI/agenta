import {ChatRole, Variant} from "@/lib/Types"
import React from "react"
import {createUseStyles} from "react-jss"
import {VARIANT_COLORS} from "."
import {Space, Typography} from "antd"
import ChatInputs from "@/components/ChatInputs/ChatInputs"
import {v4 as uuidv4} from "uuid"

const useStyles = createUseStyles({
    title: {
        fontSize: 20,
        textAlign: "center",
    },
    variantType: {
        borderRadius: "50%",
        border: `1.5px solid`,
        width: 28,
        aspectRatio: "1/1",
        display: "grid",
        placeItems: "center",
        "& .ant-typography": {
            fontSize: 16,
        },
    },
})

type Props = {
    variant: Variant
    outputText?: string
    index?: number
}

const EvaluationChatResponse: React.FC<Props> = ({variant, outputText, index = 0}) => {
    const classes = useStyles()
    const color = VARIANT_COLORS[index]

    return (
        <Space direction="vertical" size="middle">
            <Space>
                <div className={classes.variantType} style={{borderColor: color}}>
                    <Typography.Text style={{color}} strong>
                        {String.fromCharCode(65 + index)}
                    </Typography.Text>
                </div>
                <Typography.Text style={{color}} className={classes.title}>
                    {variant.variantName}
                </Typography.Text>
            </Space>
            <ChatInputs
                value={[{role: ChatRole.Assistant, content: outputText || "", id: uuidv4()}]}
                readonly
            />
        </Space>
    )
}

export default EvaluationChatResponse
