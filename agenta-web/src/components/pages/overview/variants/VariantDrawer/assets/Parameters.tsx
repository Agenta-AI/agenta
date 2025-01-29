import {useMemo} from "react"

import {Typography} from "antd"
import ResultTag from "@/components/ResultTag/ResultTag"

import {filterVariantParameters, getStringOrJson} from "@/lib/helpers/utils"
import {useStyles} from "./styles"
import {Variant} from "@/lib/Types"

export const NewVariantParametersView = ({selectedVariant}: {selectedVariant: Variant}) => {
    const {promptLlmConfig, agConfigMessages, agConfigVariables} = useMemo(() => {
        const ag_config = selectedVariant.parameters?.ag_config as unknown as Record<
            string,
            unknown
        >
        const prompt = ag_config?.prompt as Record<string, unknown>
        const promptLlmConfig = prompt.llm_config
        const agConfigMessages = prompt.messages as {
            content: string
            role: string
        }[]
        const agConfigVariables = prompt.input_keys as string[]

        return {
            promptLlmConfig,
            agConfigMessages,
            agConfigVariables,
        }
    }, [selectedVariant])

    const classes = useStyles()
    return (
        <div className="flex flex-col gap-4">
            {promptLlmConfig && Object.keys(promptLlmConfig).length ? (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <Typography.Text className={classes.subTitle}>Parameters</Typography.Text>
                        <div className="flex items-center gap-2 flex-wrap">
                            {selectedVariant.parameters &&
                                Object.entries(promptLlmConfig).map(([key, value], index) => (
                                    <ResultTag
                                        key={index}
                                        value1={key}
                                        value2={getStringOrJson(value)}
                                    />
                                ))}
                        </div>
                    </div>
                </div>
            ) : null}
            {agConfigMessages && agConfigMessages.length ? (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <Typography.Text className={classes.subTitle}>Messages</Typography.Text>
                        <div className="flex flex-col items-start gap-2">
                            {agConfigMessages.map((message, index) => {
                                return (
                                    <ResultTag
                                        key={`${message.role}-index`}
                                        value1={message.role}
                                        value2={message.content}
                                        className="[&_.value1]:whitespace-pre [&_.value1]:text-wrap"
                                    />
                                )
                            })}
                        </div>
                    </div>
                </div>
            ) : null}
            {agConfigVariables && agConfigVariables.length ? (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <Typography.Text className={classes.subTitle}>Variables</Typography.Text>
                        <div className="flex flex-col items-start gap-2">
                            {agConfigVariables.map((variable, index) => {
                                return <ResultTag key={`${variable}-index`} value1={variable} />
                            })}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export const VariantParametersView = ({selectedVariant}: {selectedVariant: Variant}) => {
    const classes = useStyles()
    return (
        <div>
            {selectedVariant.parameters && Object.keys(selectedVariant.parameters).length ? (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <Typography.Text className={classes.subTitle}>Parameters</Typography.Text>
                        <div className="flex items-center gap-2 flex-wrap">
                            {selectedVariant.parameters &&
                                Object.entries(
                                    filterVariantParameters({
                                        record: selectedVariant.parameters,
                                        key: "prompt",
                                        include: false,
                                    }),
                                ).map(([key, value], index) => (
                                    <ResultTag
                                        key={index}
                                        value1={key}
                                        value2={getStringOrJson(value)}
                                    />
                                ))}
                        </div>
                    </div>

                    {selectedVariant.parameters &&
                        Object.entries(
                            filterVariantParameters({
                                record: selectedVariant.parameters,
                                key: "prompt",
                            }),
                        ).map(([key, value], index) => (
                            <div className="flex flex-col gap-2" key={index}>
                                <Typography.Text className={classes.subTitle}>
                                    {key}
                                </Typography.Text>
                                <div className={classes.promptTextField}>
                                    {JSON.stringify(value)}
                                </div>
                            </div>
                        ))}
                </div>
            ) : (
                <Typography.Text className={classes.noParams}>No Parameters</Typography.Text>
            )}
        </div>
    )
}
