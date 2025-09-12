import isEqual from "fast-deep-equal"
import {isDraft, current as immerCurrent} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {transformedPromptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {appSchemaAtom, getEnhancedRevisionById} from "@/oss/state/variant/atoms/fetcher"

import {parametersOverrideAtomFamily} from "./parametersOverride"

// Prompts comparison: compare revision parameters.ag_config vs transformed local prompts ag_config
export const promptsDirtyAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // Guard against false positives while schema/variant are still loading
        const spec = get(appSchemaAtom)
        const variant = getEnhancedRevisionById(get as any, revisionId) as any
        if (!spec || !variant) return false

        const ogParameters = variant?.parameters
        const currentParams = get(transformedPromptsAtomFamily(revisionId))?.ag_config

        // Normalize configs by stripping derived input_keys which aren't
        // persisted with the revision. These keys are added when transforming
        // prompts and would otherwise trigger false draft states on untouched
        // revisions. Also normalize response_format differences from legacy
        // applications where it might appear in various shapes (camelCase,
        // strings or default "text" objects).
        const sanitize = (p: any) => {
            if (!p) return p
            const ag = p.ag_config ?? p

            const normalizeResponseFormat = (llm: Record<string, any>) => {
                // Determine normalized response_format value without mutating the input object
                const raw = (llm as any)?.response_format ?? (llm as any)?.responseFormat
                let rf: any = raw
                if (typeof rf === "string") {
                    if (rf === "text") {
                        rf = undefined
                    } else if (rf === "json") {
                        rf = {type: "json_object"}
                    } else {
                        rf = {type: rf}
                    }
                } else if (rf && typeof rf === "object") {
                    const t = (rf as any).type
                    if (!t || t === "text") {
                        rf = undefined
                    } else if (t === "json_object") {
                        rf = {type: "json_object"}
                    } else if (t === "json_schema" && (rf as any).json_schema) {
                        rf = {type: "json_schema", json_schema: (rf as any).json_schema}
                    } else {
                        rf = undefined
                    }
                }

                // Build a new llm_config object without the legacy camelCase key
                const {
                    responseFormat: _omitCamel,
                    response_format: _omitSnake,
                    ...rest
                } = llm as any
                const next: Record<string, any> = {...rest}
                if (rf) next.response_format = rf
                return next
            }

            return Object.entries(ag).reduce(
                (acc, [key, value]) => {
                    if (value && typeof value === "object") {
                        const {input_keys, template_format, ...rest} = value as any
                        if (
                            (rest as any).llm_config &&
                            typeof (rest as any).llm_config === "object"
                        ) {
                            const llm = (rest as any).llm_config
                            const normalizedLlm = normalizeResponseFormat(llm)
                            if (
                                Array.isArray((normalizedLlm as any).tools) &&
                                (normalizedLlm as any).tools.length === 0
                            ) {
                                const {tools, ...llmWithoutTools} = normalizedLlm as any
                                ;(rest as any).llm_config = llmWithoutTools
                            } else {
                                ;(rest as any).llm_config = normalizedLlm
                            }
                        }
                        if (template_format && template_format !== "curly") {
                            ;(rest as any).template_format = template_format
                        }
                        acc[key] = rest
                    } else {
                        acc[key] = value as any
                    }
                    return acc
                },
                {} as Record<string, any>,
            )
        }

        // If either params object is an Immer draft, unwrap to a plain snapshot
        const currPlain = isDraft(currentParams)
            ? ((immerCurrent(currentParams) as any) ?? currentParams)
            : currentParams
        const ogPlain = isDraft(ogParameters)
            ? ((immerCurrent(ogParameters) as any) ?? ogParameters)
            : ogParameters

        const _isEqual = isEqual(sanitize(currPlain), sanitize(ogPlain))

        return !_isEqual
    }),
)

// Combined dirty flag
export const variantIsDirtyAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const promptsDirty = get(promptsDirtyAtomFamily(variantId))
        const override = get(parametersOverrideAtomFamily(variantId))

        if (promptsDirty) return true

        // If a JSON override exists and differs from the saved parameters, mark dirty
        if (override) {
            const variant = getEnhancedRevisionById(get as any, variantId) as any
            const ogParameters = variant?.parameters
            if (!isEqual(override, ogParameters)) return true
        }

        return false
    }),
)
