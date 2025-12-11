import {memo, useMemo} from "react"

import {Empty, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {PromptsSourceProvider} from "@/oss/components/Playground/context/PromptsSource"
import type {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import type {AgentaConfigPrompt} from "@/oss/lib/shared/variant/transformer/types"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

import PromptConfigCardSkeleton from "./PromptConfigCardSkeleton"

type ParametersShape = Record<string, any> | null | undefined

type PromptNode = EnhancedObjectConfig<AgentaConfigPrompt>

const PlaygroundVariantConfigPrompt = dynamic(
    () => import("@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"),
    {ssr: false, loading: () => <PromptConfigCardSkeleton />},
)

const PlaygroundVariantCustomProperties = dynamic(
    () => import("@/oss/components/Playground/Components/PlaygroundVariantCustomProperties"),
    {ssr: false, loading: () => <PromptConfigCardSkeleton />},
)

const {Text} = Typography

const unwrapValue = <T,>(value: T): T extends {value: infer U} ? U : T => {
    if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
        return (value as Record<string, unknown>).value as any
    }
    return value as any
}

const extractCustomProps = (parameters: ParametersShape): Record<string, any> => {
    if (!parameters || typeof parameters !== "object") return {}

    const candidates = [
        (parameters as any).custom_properties,
        (parameters as any).customProps,
        (parameters as any).customProperties,
        (parameters as any).configuration?.custom_properties,
        (parameters as any).configuration?.customProps,
    ]

    for (const candidate of candidates) {
        const unwrapped = unwrapValue(candidate)
        if (unwrapped && typeof unwrapped === "object") {
            return unwrapped as Record<string, any>
        }
    }

    return {}
}

const normalizeMessageContent = (content: any) => {
    const unwrapped = unwrapValue(content)
    if (Array.isArray(unwrapped)) {
        return unwrapped.map((entry) => unwrapValue(entry))
    }
    return unwrapped
}

const normalizeMessages = (messages: any, promptKey: string): any[] => {
    const list = unwrapValue(messages)
    if (!Array.isArray(list)) {
        return []
    }

    return list.map((message, index) => {
        const raw = unwrapValue(message)
        if (!raw || typeof raw !== "object") {
            return {
                __id: `${promptKey}-message-${index}`,
                role: "user",
                content: raw,
            }
        }

        const role = unwrapValue((raw as any).role) ?? "user"
        const content = normalizeMessageContent((raw as any).content ?? raw)

        return {
            ...(typeof raw === "object" ? raw : {}),
            __id: (raw as any).__id ?? `${promptKey}-message-${index}`,
            role,
            content,
        }
    })
}

// Helper function to resolve the prompt key with fallback logic
const resolvePromptKey = (base: Record<string, any>, index: number) => {
    return (
        unwrapValue(base.__id) ??
        unwrapValue(base.__name) ??
        unwrapValue(base.id) ??
        `prompt-${index}`
    )
}

const normalizePromptNode = (prompt: any, index: number): PromptNode | null => {
    if (!prompt || typeof prompt !== "object") return null
    const base = prompt as Record<string, any>
    const promptKey = resolvePromptKey(base, index)
    const promptName =
        unwrapValue(base.__name) ??
        unwrapValue(base.name) ??
        unwrapValue(base.label) ??
        `Prompt ${index + 1}`

    const messages = normalizeMessages(base.messages ?? base.prompt ?? [], String(promptKey))
    const llmConfig = unwrapValue(base.llm_config ?? base.llmConfig)

    return {
        ...base,
        __id: String(promptKey),
        __name: String(promptName),
        messages,
        llm_config: llmConfig,
    }
}

const extractPromptsFromParameters = (parameters: ParametersShape): PromptNode[] => {
    if (!parameters || typeof parameters !== "object") return []

    const direct = unwrapValue((parameters as any).prompts)
    if (Array.isArray(direct) && direct.length > 0) {
        return direct
            .map((entry, index) => normalizePromptNode(entry, index))
            .filter(Boolean) as PromptNode[]
    }

    const agConfig = unwrapValue((parameters as any).ag_config ?? (parameters as any).agConfig)
    if (agConfig && typeof agConfig === "object") {
        return Object.entries(agConfig)
            .map(([name, cfg], index) => {
                if (!cfg || typeof cfg !== "object") return null

                const normalized = normalizePromptNode(
                    {
                        ...(cfg as Record<string, any>),
                        __name: (cfg as any)?.__name ?? name,
                    },
                    index,
                )
                return normalized
            })
            .filter(Boolean) as PromptNode[]
    }

    return []
}

const hasCustomPropsContent = (record: Record<string, any>): boolean => {
    return Object.values(record).some((value) => {
        if (value === null || value === undefined) return false
        if (Array.isArray(value)) return value.length > 0
        if (typeof value === "object") return Object.keys(value).length > 0
        if (typeof value === "string") return value.trim().length > 0
        return true
    })
}

interface PromptConfigCardProps {
    variantId?: string | null
    parameters?: ParametersShape
    customProperties?: Record<string, any> | null
    isLoading?: boolean
    hasSnapshot?: boolean
    className?: string
}

const PromptConfigCard = ({
    variantId,
    parameters,
    customProperties,
    isLoading = false,
    hasSnapshot = false,
    className,
}: PromptConfigCardProps) => {
    const normalizedVariantId = useMemo(() => (variantId ? String(variantId) : ""), [variantId])
    const resolvedRevisionId = normalizedVariantId || "__missing__"

    // DEBUG: Log input props
    console.log("[PromptConfigCard] variantId:", variantId)
    console.log("[PromptConfigCard] normalizedVariantId:", normalizedVariantId)
    console.log("[PromptConfigCard] resolvedRevisionId:", resolvedRevisionId)
    console.log("[PromptConfigCard] parameters:", parameters)
    console.log("[PromptConfigCard] customProperties:", customProperties)
    console.log("[PromptConfigCard] isLoading:", isLoading)
    console.log("[PromptConfigCard] hasSnapshot:", hasSnapshot)

    const derivedPrompts = useAtomValue(promptsAtomFamily(resolvedRevisionId)) as PromptNode[]
    const derivedCustomProps = useAtomValue(
        customPropertiesByRevisionAtomFamily(resolvedRevisionId),
    ) as Record<string, any>

    const promptsList = useMemo(() => extractPromptsFromParameters(parameters), [parameters])

    const combinedPrompts = useMemo(() => {
        if (promptsList.length > 0) return promptsList
        if (normalizedVariantId) return Array.isArray(derivedPrompts) ? derivedPrompts : []
        return [] as PromptNode[]
    }, [promptsList, normalizedVariantId, derivedPrompts])

    const combinedCustomProps = useMemo(() => {
        if (customProperties && Object.keys(customProperties).length > 0) {
            return customProperties
        }
        if (
            normalizedVariantId &&
            derivedCustomProps &&
            Object.keys(derivedCustomProps).length > 0
        ) {
            return derivedCustomProps
        }
        // Fallback: extract custom properties directly from parameters if not found in customProperties or derivedCustomProps.
        // This ensures we always attempt to extract custom properties, even if the atoms are empty or unavailable.
        // This is not redundant, as customProperties and derivedCustomProps may be sourced differently.
        return extractCustomProps(parameters)
    }, [customProperties, normalizedVariantId, derivedCustomProps, parameters])

    const hasPrompts = combinedPrompts.length > 0
    const hasCustomProps = hasCustomPropsContent(combinedCustomProps)
    const hasContent = hasPrompts || hasCustomProps

    // DEBUG: Log derived state
    console.log("[PromptConfigCard] derivedPrompts:", derivedPrompts)
    console.log("[PromptConfigCard] derivedCustomProps:", derivedCustomProps)
    console.log("[PromptConfigCard] promptsList (from extractPromptsFromParameters):", promptsList)
    console.log("[PromptConfigCard] combinedPrompts:", combinedPrompts)
    console.log("[PromptConfigCard] combinedCustomProps:", combinedCustomProps)
    console.log("[PromptConfigCard] hasPrompts:", hasPrompts)
    console.log("[PromptConfigCard] hasCustomProps:", hasCustomProps)
    console.log("[PromptConfigCard] hasContent:", hasContent)

    const promptsMap = useMemo(() => {
        if (!normalizedVariantId || !hasPrompts) return {}
        return {[normalizedVariantId]: combinedPrompts}
    }, [normalizedVariantId, hasPrompts, combinedPrompts])

    const emptyDescription = hasSnapshot
        ? "No prompt snapshot returned for this variant."
        : "No configuration snapshot available for this variant."

    if (isLoading) {
        return <PromptConfigCardSkeleton />
    }

    if (!normalizedVariantId) {
        return (
            <div className={className}>
                <div className="flex items-center justify-center py-8 px-4">
                    <Empty
                        description={
                            <Text type="secondary" className="text-center">
                                Prompt configuration unavailable because the revision identifier is
                                missing.
                            </Text>
                        }
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                </div>
            </div>
        )
    }

    if (!hasContent) {
        return (
            <div className={className}>
                <div className="flex items-center justify-center py-8 px-4">
                    <Empty
                        description={
                            <Text type="secondary" className="text-center">
                                {emptyDescription}
                            </Text>
                        }
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className={className}>
            <PromptsSourceProvider promptsByRevision={promptsMap}>
                <div className="flex flex-col w-full">
                    {hasPrompts
                        ? combinedPrompts.map((prompt, index) => {
                              const promptKey =
                                  (prompt as any)?.__id ??
                                  (prompt as any)?.__name ??
                                  (prompt as any)?.id ??
                                  (prompt as any)?.name ??
                                  `prompt-${index}`
                              return (
                                  <PlaygroundVariantConfigPrompt
                                      key={`${normalizedVariantId}:${promptKey}`}
                                      variantId={normalizedVariantId}
                                      promptId={String(promptKey)}
                                      viewOnly
                                  />
                              )
                          })
                        : null}

                    {hasCustomProps ? (
                        <PlaygroundVariantCustomProperties
                            variantId={normalizedVariantId}
                            initialOpen
                            viewOnly
                            customPropsRecord={combinedCustomProps}
                        />
                    ) : null}
                </div>
            </PromptsSourceProvider>
        </div>
    )
}

export default memo(PromptConfigCard)
