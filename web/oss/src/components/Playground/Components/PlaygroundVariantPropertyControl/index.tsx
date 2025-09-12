import {memo, useMemo} from "react"

import {Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import {usePromptsSource} from "../../context/PromptsSource"
import {findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"
import {
    unifiedPropertyMetadataAtomFamily,
    unifiedPropertyValueAtomFamily,
    updateGenerationDataPropertyMutationAtom,
    promptPropertyAtomFamily,
} from "../../state/atoms"

import {renderMap} from "./assets/helpers"
import type {PlaygroundVariantPropertyControlProps} from "./types"

const nullValueAtom = atom<any>(null)
const nullMetadataAtom = atom<any>(null)
const noopWriteAtom = atom(null, () => {})

// TODO: RENAME TO PlaygroundPropertyControl
const PlaygroundVariantPropertyControl = ({
    propertyId,
    variantId,
    className,
    as,
    view,
    rowId,
    messageId,
    withTooltip,
    value: propsValue,
    disabled,
    onChange,
    placeholder,
    ...rest
}: PlaygroundVariantPropertyControlProps): React.ReactElement | null => {
    // Get the actual variant ID
    const actualVariantId = typeof variantId === "object" ? (variantId as any).id : variantId

    // (debug reads removed to avoid extra subscriptions)

    // ATOM-LEVEL: compute selector atoms (stable via useMemo), no conditional hooks
    const propertyValueAtom = useMemo(() => {
        if (!propertyId) return nullValueAtom
        return unifiedPropertyValueAtomFamily({
            variantId: actualVariantId,
            propertyId,
            rowId,
            messageId,
        })
    }, [actualVariantId, propertyId, rowId, messageId])

    const propertyMetadataAtom = useMemo(() => {
        if (!propertyId) return nullMetadataAtom
        return unifiedPropertyMetadataAtomFamily({
            variantId: actualVariantId,
            propertyId,
            rowId,
            messageId,
        })
    }, [actualVariantId, propertyId, rowId, messageId])

    // Subscribe to unified property data (handles both variant and generation data)
    let propertyData = useAtomValue(propertyValueAtom)
    let propertyMetadata = useAtomValue(propertyMetadataAtom)

    // Provider-aware fallback: if atom lookup misses but provider prompts have the node, synthesize data
    const providerPrompts = usePromptsSource(actualVariantId || "")
    let providerNode: any = null
    if (!propertyData && Array.isArray(providerPrompts) && providerPrompts.length > 0) {
        const node = findPropertyInObject(providerPrompts, propertyId)
        if (node) {
            providerNode = node
            propertyData = {
                value: (node as any)?.content?.value ?? (node as any)?.value,
                source: "variant",
                property: node,
            } as any
        }
    }

    // If metadata is missing, has UUID-like title, or is an incorrect base type (e.g. "string" for a compound node),
    // replace it with the provider's lazy metadata and normalize the title.
    const titleStr = ((propertyMetadata as any)?.title || "") as string
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        titleStr,
    )
    const looksCompoundNode =
        providerNode &&
        typeof providerNode === "object" &&
        "selected" in providerNode &&
        "value" in providerNode
    if (
        (!propertyMetadata ||
            !(propertyMetadata as any)?.title ||
            looksLikeUuid ||
            ((propertyMetadata as any)?.type === "string" && looksCompoundNode)) &&
        providerNode?.__metadata
    ) {
        const lazy = getMetadataLazy(providerNode.__metadata) as any
        const key = (lazy?.key || providerNode?.key || "").toString()
        const toTitle = (s: string) =>
            s
                ? s
                      .replace(/([A-Z])/g, " $1")
                      .replace(/_/g, " ")
                      .replace(/^\w/, (c) => c.toUpperCase())
                : ""
        propertyMetadata = {
            ...(lazy || {}),
            key: lazy?.key || key,
            title: lazy?.title || toTitle(key),
        }
    }

    // Final debug dump so we can compare what the renderer will see

    // Mutations
    const updateGenerationDataProperty = useSetAtom(updateGenerationDataPropertyMutationAtom)

    // Prompts-only write facade for variant updates
    const variantPromptWriteAtom = useMemo(() => {
        if (!actualVariantId || !propertyId) return noopWriteAtom
        return promptPropertyAtomFamily({revisionId: actualVariantId, propertyId})
    }, [actualVariantId, propertyId])
    const setVariantPromptValue = useSetAtom(variantPromptWriteAtom)

    const property = useMemo(() => {
        // Fallback: if data is missing but metadata exists (common in read-only/provider views),
        // synthesize a non-interactive property so the UI can still render disabled controls.
        if (!propertyData && propertyMetadata) {
            return {
                __metadata: propertyMetadata,
                value: undefined,
                handleChange: (_: any) => {},
            }
        }
        if (!propertyData || !propertyMetadata) return null

        const {value, source} = propertyData

        const handler = (newValue: any, _: any, targetPropertyId?: string) => {
            const actualPropertyId = targetPropertyId || propertyId

            // No-op guard: skip if value hasn't changed to avoid redundant atom writes
            const currentVal = value
            const isSame =
                typeof newValue === "object" && newValue !== null
                    ? deepEqual(newValue, currentVal)
                    : newValue === currentVal
            if (isSame) return

            if (source === "generationData" && rowId) {
                updateGenerationDataProperty({
                    rowId,
                    propertyId: actualPropertyId,
                    value: newValue,
                    messageId,
                    revisionId: actualVariantId, // ensure per-revision writes in comparison mode
                })
            } else if (source === "variant" && actualVariantId) {
                // Use prompts-only facade to route writes through the centralized mutation
                setVariantPromptValue(newValue)
            } else {
                // keep silent in production; warn only in dev
                if (process.env.NODE_ENV !== "production") {
                    console.warn("[PROPERTY CONTROL DEBUG] Unknown mutation target", {
                        source,
                        variantId: actualVariantId,
                        rowId,
                        propertyId: actualPropertyId,
                    })
                }
            }
        }

        return {
            __metadata: propertyMetadata && propertyMetadata, // already precomputed metadata
            value,
            handleChange: handler,
        }
    }, [
        propertyData,
        propertyMetadata,
        propertyId,
        rowId,
        actualVariantId,
        updateGenerationDataProperty,
        messageId,
    ])

    // Defensive programming: Handle revoked proxy for entire property object
    const {metadata, value, handleChange} = useMemo(() => {
        try {
            if (!property) {
                return {metadata: null, value: null, handleChange: null}
            }
            return {
                metadata: property.__metadata,
                value: property.value,
                handleChange: property.handleChange,
            }
        } catch (error) {
            console.error(
                "[PlaygroundVariantPropertyControl] Error accessing property (revoked proxy)",
                error,
            )
            return {metadata: null, value: null, handleChange: null}
        }
    }, [property])

    if (!property) {
        return null
    }

    // Early return if no metadata
    if (!metadata) {
        return <Typography.Text>Unable to find metadata for property</Typography.Text>
    }

    const metadataType: string | undefined = (() => {
        try {
            return (metadata as any)?.type
        } catch {
            return undefined
        }
    })()

    if (!metadataType) {
        return <Typography.Text>No property type found</Typography.Text>
    }

    const renderer = renderMap[metadataType as keyof typeof renderMap] as
        | ((props: any) => React.ReactElement)
        | undefined
    if (renderer) {
        return renderer({
            withTooltip,
            metadata: metadata,
            value: propsValue ?? value,
            handleChange,
            as,
            className,
            view,
            placeholder,
            disabled,
            propertyId: (propertyData as any)?.property?.__id || propertyId,
            variantId: variantId,
            baseProperty: (propertyData as any)?.property,
            ...rest,
        })
    }

    return <Typography.Text>Unknown type: {metadataType}</Typography.Text>
}

export default memo(PlaygroundVariantPropertyControl)
