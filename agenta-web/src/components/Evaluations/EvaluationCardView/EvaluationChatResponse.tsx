import {ChatRole, Evaluation, Variant} from "@/lib/Types"
import React from "react"
import {createUseStyles} from "react-jss"
import {VARIANT_COLORS} from "."
import {Space, Typography} from "antd"
import ChatInputs from "@/components/ChatInputs/ChatInputs"
import {v4 as uuidv4} from "uuid"
import VariantAlphabet from "./VariantAlphabet"

const useStyles = createUseStyles({
    title: {
        fontSize: 20,
        textAlign: "center",
    },
})

type Props = {
    variant: Variant
    outputText?: string
    index?: number
    showVariantName?: boolean
    evaluation: Evaluation
}

const EvaluationChatResponse: React.FC<Props> = ({
    variant,
    outputText,
    index = 0,
    showVariantName = true,
    evaluation,
}) => {
    const classes = useStyles()
    const color = VARIANT_COLORS[index]

    return (
        <Space direction="vertical" size="middle">
            {showVariantName && (
                <Space>
                    <VariantAlphabet index={index} width={28} />
                    <Typography.Text style={{color}} className={classes.title}>
                        {variant.variantName}{" "}
                        {evaluation.revisions[index] && (
                            <span style={{color: "#656d76", fontSize: 14}}>
                                v{evaluation.revisions[index]}
                            </span>
                        )}
                    </Typography.Text>
                </Space>
            )}
            <ChatInputs
                value={[{role: ChatRole.Assistant, content: outputText || "", id: uuidv4()}]}
                readonly
            />
        </Space>
    )
}

export default EvaluationChatResponse
