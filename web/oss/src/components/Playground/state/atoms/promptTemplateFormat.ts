import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import {updateVariantPropertyEnhancedMutationAtom} from "./propertyMutations"

export type PromptTemplateFormat = "curly" | "fstring" | "jinja2"

const SUPPORTED_FORMATS: PromptTemplateFormat[] = ["curly", "fstring", "jinja2"]

const sanitizeFormat = (value: unknown): PromptTemplateFormat | undefined => {
    if (typeof value !== "string") return undefined
    const lowered = value.toLowerCase()
    if (lowered === "jinja") {
        return "jinja2"
    }
    return SUPPORTED_FORMATS.find((format) => format === lowered) ?? undefined
}

const getTemplateFormatNode = (prompt: any): any => {
    if (!prompt || typeof prompt !== "object") return undefined
    return (
        prompt.templateFormat ??
        prompt.template_format ??
        prompt?.prompt?.templateFormat ??
        prompt?.prompt?.template_format
    )
}

const getTemplateFormatValue = (node: any): PromptTemplateFormat | undefined => {
    if (!node) return undefined
    if (typeof node === "string") return sanitizeFormat(node)
    if (typeof node === "object") {
        if (typeof node.value === "string") return sanitizeFormat(node.value)
        if (typeof node.default === "string") return sanitizeFormat(node.default)
    }
    return undefined
}

const getTemplateFormatPropertyId = (node: any): string | undefined => {
    if (!node || typeof node !== "object") return undefined
    const candidate = node.__id ?? node.id
    return typeof candidate === "string" ? candidate : undefined
}

const DEFAULT_TEMPLATE_FORMAT: PromptTemplateFormat = "curly"

export const promptTemplateFormatAtomFamily = atomFamily((revisionId: string) =>
    atom<PromptTemplateFormat, PromptTemplateFormat>(
        (get) => {
            // Use molecule-backed prompts for single source of truth
            const prompts = get(moleculeBackedPromptsAtomFamily(revisionId))
            if (!Array.isArray(prompts) || prompts.length === 0) {
                return DEFAULT_TEMPLATE_FORMAT
            }

            const formats = prompts
                .map((prompt) => getTemplateFormatValue(getTemplateFormatNode(prompt)))
                .filter(Boolean) as PromptTemplateFormat[]

            if (formats.length === 0) return DEFAULT_TEMPLATE_FORMAT

            const unique = new Set(formats)
            if (unique.size === 1) {
                return formats[0]
            }

            // If prompts disagree, prefer the first non-default selection
            const firstNonDefault = formats.find((format) => format !== DEFAULT_TEMPLATE_FORMAT)
            return firstNonDefault ?? DEFAULT_TEMPLATE_FORMAT
        },
        (get, set, nextFormat) => {
            // Use molecule-backed prompts for single source of truth
            const prompts = get(moleculeBackedPromptsAtomFamily(revisionId))
            if (!Array.isArray(prompts) || prompts.length === 0) {
                return
            }

            const normalizedFormat = sanitizeFormat(nextFormat) ?? DEFAULT_TEMPLATE_FORMAT

            prompts.forEach((prompt: any) => {
                const node = getTemplateFormatNode(prompt)
                const propertyId = getTemplateFormatPropertyId(node)
                if (propertyId) {
                    set(updateVariantPropertyEnhancedMutationAtom, {
                        variantId: revisionId,
                        propertyId,
                        value: normalizedFormat,
                    })
                }
            })

            set(moleculeBackedPromptsAtomFamily(revisionId), (prev: any) =>
                produce(prev ?? [], (draft: any[]) => {
                    draft.forEach((prompt: any) => {
                        const node = getTemplateFormatNode(prompt)
                        if (node && typeof node === "object") {
                            if ("value" in node) {
                                node.value = normalizedFormat
                                return
                            }
                            if ("default" in node) {
                                node.default = normalizedFormat
                                return
                            }
                        }
                        prompt.templateFormat = normalizedFormat
                    })
                }),
            )
        },
    ),
)
