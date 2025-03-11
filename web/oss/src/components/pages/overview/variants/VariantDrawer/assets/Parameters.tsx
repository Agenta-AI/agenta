import {useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"

import {EnhancedVariant} from "@/oss/components/NewPlayground/assets/utilities/transformer/types"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {filterVariantParameters, getStringOrJson} from "@/oss/lib/helpers/utils"
import {Variant} from "@/oss/lib/Types"

import {useStyles} from "./styles"

export const NewVariantParametersView = ({selectedVariant}: {selectedVariant: EnhancedVariant}) => {
    const {promptConfigs, customConfigs} = useMemo(() => {
        const ag_config = selectedVariant.parameters?.agConfig as unknown as Record<string, unknown>
        const promptKeys = selectedVariant.prompts.map((prompt) => prompt.__name)

        const promptConfigs = promptKeys.reduce(
            (acc, cur) => {
                if (!cur) return acc

                const currentPrompt = ag_config[cur] as Record<string, unknown>
                if (!currentPrompt) return acc
                acc[cur] = {
                    llmConfig: currentPrompt.llm_config as Record<string, unknown>,
                    messages: currentPrompt.messages as any[],
                    variables: currentPrompt.input_keys as string[],
                }

                return acc
            },
            {} as Record<
                string,
                {llmConfig: Record<string, unknown>; messages: any[]; variables: string[]}
            >,
        )

        const customConfigs = Object.keys(selectedVariant.customProperties || {}).reduce(
            (acc, cur) => {
                const val = ag_config[cur]
                if (val && cur) {
                    acc[cur] = val
                }

                return acc
            },
            {} as Record<string, unknown>,
        )

        return {
            promptConfigs,
            customConfigs,
        }
    }, [selectedVariant])

    const classes = useStyles()
    return (
        <div className="flex flex-col gap-4">
            {Object.keys(promptConfigs).map((key, index) => {
                return (
                    <div key={`${index}-${key}`}>
                        <Typography.Text className={clsx(classes.title)}>{key}</Typography.Text>
                        <div className="flex flex-col gap-2 mt-2">
                            {promptConfigs[key].llmConfig && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    {selectedVariant.parameters &&
                                        Object.entries(promptConfigs[key].llmConfig).map(
                                            ([key, value], index) => (
                                                <ResultTag
                                                    key={index}
                                                    value1={key}
                                                    value2={getStringOrJson(value)}
                                                />
                                            ),
                                        )}
                                </div>
                            )}
                            {promptConfigs[key].messages && (
                                <div className="flex flex-col gap-6">
                                    <div className="flex flex-col gap-2">
                                        <Typography.Text className={classes.subTitle}>
                                            Messages
                                        </Typography.Text>
                                        <div className="flex flex-col items-start gap-2">
                                            {promptConfigs[key].messages.map((message, index) => {
                                                return (
                                                    <ResultTag
                                                        key={`${message.role}-${index}`}
                                                        value1={message.role}
                                                        value2={message.content}
                                                        className="[&_.value1]:whitespace-pre [&_.value1]:text-wrap"
                                                    />
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {promptConfigs[key].variables && (
                                <div className="flex flex-col gap-6">
                                    <div className="flex flex-col gap-2">
                                        <Typography.Text className={classes.subTitle}>
                                            Variables
                                        </Typography.Text>
                                        <div className="flex flex-col items-start gap-2">
                                            {promptConfigs[key].variables.map((variable, index) => {
                                                return (
                                                    <ResultTag
                                                        key={`${variable}-${index}`}
                                                        value1={variable}
                                                    />
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            })}
            {Object.keys(customConfigs).length ? (
                <div>
                    <Typography.Text className={classes.title}>
                        Custom Properties
                        <div className="flex flex-col items-start gap-2 mt-2">
                            {Object.keys(customConfigs).map((key, index) => {
                                const variable = customConfigs[key]

                                if (typeof variable === "object") {
                                    return (
                                        <div key={`${key}-${index}-custom`}>
                                            <Typography.Text className={classes.subTitle}>
                                                {key}
                                            </Typography.Text>
                                            <div className="flex flex-col gap-2">
                                                {Object.entries(variable || {}).map(
                                                    ([key, value], index) => (
                                                        <ResultTag
                                                            key={index}
                                                            value1={key}
                                                            value2={getStringOrJson(value)}
                                                        />
                                                    ),
                                                )}
                                            </div>
                                        </div>
                                    )
                                } else {
                                    return variable ? (
                                        <ResultTag
                                            key={`${variable}-${index}`}
                                            value1={key}
                                            value2={variable as string}
                                        />
                                    ) : null
                                }
                            })}
                        </div>
                    </Typography.Text>
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
