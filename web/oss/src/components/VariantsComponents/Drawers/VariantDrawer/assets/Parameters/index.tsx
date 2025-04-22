import {useMemo} from "react"

import {Typography} from "antd"
import dynamic from "next/dynamic"

import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {filterVariantParameters, getStringOrJson, getYamlOrJson} from "@/oss/lib/helpers/utils"
import {EnhancedVariant, VariantParameters} from "@/oss/lib/shared/variant/transformer/types"

import {useStyles} from "../styles"
import {DrawerVariant} from "../types"

const SharedEditor = dynamic(
    () => import("@/oss/components/NewPlayground/Components/SharedEditor"),
    {ssr: false},
)

export const NewVariantParametersView = ({
    selectedVariant,
}: {
    selectedVariant: EnhancedVariant
    parameters?: Record<string, unknown>
}) => {
    const configJsonString = useMemo(() => {
        interface OptionalParameters extends Omit<VariantParameters, "agConfig"> {
            agConfig?: VariantParameters["agConfig"]
        }
        const parameters = structuredClone(selectedVariant.parameters) as OptionalParameters
        if (parameters && parameters.agConfig) {
            delete parameters.agConfig
            return getYamlOrJson("JSON", parameters)
        }
        return ""
    }, [selectedVariant?.id])

    return (
        <div className="w-full h-full self-stretch grow" key={selectedVariant?.id}>
            <SharedEditor
                readOnly
                editorProps={{
                    codeOnly: true,
                }}
                editorType="border"
                initialValue={configJsonString}
                handleChange={() => {}}
                className="!w-[97%] *:font-mono"
            />
        </div>
    )
}

export const VariantParametersView = ({selectedVariant}: {selectedVariant: DrawerVariant}) => {
    const classes = useStyles()
    return (
        <div>
            {selectedVariant.parameters && Object.keys(selectedVariant.parameters).length ? (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <Typography.Text className={classes.subTitle}>Parameters</Typography.Text>
                        <div className="flex items-center gap-2 flex-wrap">
                            {selectedVariant?.parameters &&
                                Object.entries(
                                    filterVariantParameters({
                                        record: selectedVariant?.parameters,
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
