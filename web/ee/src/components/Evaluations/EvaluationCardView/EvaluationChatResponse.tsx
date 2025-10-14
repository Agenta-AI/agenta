import {memo, useMemo} from "react"

import {Space, Typography} from "antd"
import {createUseStyles} from "react-jss"
import {v4 as uuidv4} from "uuid"

import ChatInputs from "@/oss/components/ChatInputs/ChatInputs"
import {safeParse} from "@/oss/lib/helpers/utils"
import {ChatRole, Evaluation, Variant} from "@/oss/lib/Types"

import {VARIANT_COLORS} from "./assets/styles"
import VariantAlphabet from "./VariantAlphabet"

const useStyles = createUseStyles({
    title: {
        fontSize: 20,
        textAlign: "center",
    },
})

interface Props {
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
    const parsedOutput = safeParse(outputText || "", null)
    const messageContent =
        parsedOutput && typeof parsedOutput === "object" && "content" in parsedOutput
            ? parsedOutput.content
            : outputText || ""

    const chatValue = useMemo(
        () => [{role: ChatRole.Assistant, content: messageContent, id: uuidv4()}],
        [messageContent],
    )

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
            <ChatInputs value={chatValue} readonly />
        </Space>
    )
}

export default memo(EvaluationChatResponse)
