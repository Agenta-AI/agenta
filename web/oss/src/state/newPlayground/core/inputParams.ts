import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {StringMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import {requestSchemaMetaAtomFamily} from "./requestSchemaMeta"

export interface InputParamsAtomParams {
    variant: EnhancedVariant
    routePath?: string
}

export interface InputParam extends StringMetadata {
    name: string
}

export const inputParamsAtomFamily = atomFamily((params: InputParamsAtomParams) =>
    atom<InputParam[]>((get) => {
        const {variant, routePath} = params
        const meta = get(requestSchemaMetaAtomFamily({variant, routePath}))
        // Map each input key to a default string metadata. If we later infer richer types
        // from the OpenAPI schema, we can enhance this mapping.
        return meta.inputKeys.map((key) => ({
            name: key,
            type: "string",
            title: key,
            nullable: false,
            allowFreeform: true,
        }))
    }),
)
