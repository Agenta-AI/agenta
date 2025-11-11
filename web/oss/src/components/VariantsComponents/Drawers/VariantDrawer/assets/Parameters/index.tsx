import {useCallback, useMemo} from "react"

import dynamic from "next/dynamic"

import {getYamlOrJson} from "@/oss/lib/helpers/utils"
import {VariantUpdateFunction} from "@/oss/lib/hooks/useStatelessVariants/types"
import {EnhancedVariant, VariantParameters} from "@/oss/lib/shared/variant/transformer/types"

const SharedEditor = dynamic(() => import("@/oss/components/Playground/Components/SharedEditor"), {
    ssr: false,
})

export const NewVariantParametersView = ({
    selectedVariant,
    mutateVariant,
}: {
    selectedVariant: EnhancedVariant
    parameters?: Record<string, unknown>
    mutateVariant?:
        | ((updates: Partial<EnhancedVariant> | VariantUpdateFunction) => Promise<void>)
        | undefined
}) => {
    const configJsonString = useMemo(() => {
        interface OptionalParameters extends Omit<VariantParameters, "agConfig"> {
            agConfig?: VariantParameters["agConfig"]
        }
        const parameters = structuredClone(selectedVariant.parameters) as OptionalParameters
        if (parameters) {
            delete parameters.agConfig
            delete parameters.ag_config

            return getYamlOrJson("JSON", parameters)
        }
        return ""
    }, [selectedVariant?.id])

    const onChange = useCallback(
        (value: string) => {
            if (!mutateVariant || !value || !selectedVariant?.id) return

            try {
                mutateVariant?.((variant) => {
                    if (!variant) return

                    const newParameters = structuredClone(JSON.parse(value || "{}"))

                    if (Object.keys(newParameters || {}).length) {
                        variant.parameters = newParameters
                    }

                    return variant
                })
            } catch (error) {}
        },
        [mutateVariant],
    )

    return (
        <div className="w-full h-full self-stretch grow" key={selectedVariant?.id}>
            <SharedEditor
                editorProps={{
                    codeOnly: true,
                    validationSchema: {
                        type: "object",
                        properties: {},
                    },
                }}
                editorType="border"
                initialValue={configJsonString}
                value={configJsonString}
                handleChange={onChange}
                className="!w-[97%] *:font-mono"
            />
        </div>
    )
}
