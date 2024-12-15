import {useMemo} from "react"
import {getBodySchemaName} from "@/lib/helpers/openapi_parser"
import {type StateVariant, type SchemaObject} from "../../state/types"
import {groupConfigOptions} from "./assets/helpers"
import {PromptConfigType} from "./types"

const useAgentaConfig = ({variant}: {variant: StateVariant}) => {
    const schemaName = variant.schema ? getBodySchemaName(variant.schema) : ""

    const promptParams: SchemaObject = variant.schema
        ? (variant.schema.components.schemas[schemaName]?.properties?.agenta_config || {} as SchemaObject)
        : {} as SchemaObject

    // TODO: refactor when we have multiple prompts
    const prompts: PromptConfigType[] = useMemo(() => {
        const promptProperties = groupConfigOptions<false, true>({
            schemaName,
            configObject: promptParams?.properties || {},
            filterByName: (propertyName) => propertyName.includes("prompt_"),
        })
        const modelProperties = groupConfigOptions<false, false>({
            schemaName,
            configObject: promptParams?.properties || {},
            filterByName: (propertyName) => !propertyName.includes("prompt_"),
        })

        const modelDefaults = groupConfigOptions<true, false>({
            schemaName,
            configObject: promptParams?.default,
            filterByName: (propertyName) => !propertyName.includes("prompt_"),
            reduce: true,
        })

        const promptDefaults = groupConfigOptions<true, true>({
            schemaName,
            configObject: promptParams?.default,
            filterByName: (propertyName) => propertyName.includes("prompt_"),
            reduce: true,
        })

        return [
            {
                key: `${schemaName}-prompt-${1}`,
                modelProperties,
                modelDefaults,
                promptProperties,
                promptDefaults,
            },
        ]
    }, [promptParams?.default, promptParams?.properties, schemaName])

    return {
        schemaName,
        prompts,
    }
}

export default useAgentaConfig
