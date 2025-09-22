import {memo, useMemo} from "react"

import {Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {getEnhancedRevisionById} from "@/oss/state/variant/atoms/fetcher"

import {usePromptsSource} from "../../context/PromptsSource"
import {findPropertyInObject, findPropertyById} from "../../hooks/usePlayground/assets/helpers"
import {
    // updateGenerationDataPropertyMutationAtom,
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

    // ATOM-LEVEL: compute selector atoms (stable via useMemo), no conditional hooks
    const propertyValueAtom = useMemo(() => {
        if (!propertyId) return nullValueAtom
        // Prompt-only: find property in prompts or custom properties for the given revision
        return atom((get) => {
            const revIdForPrompts = actualVariantId
            if (revIdForPrompts) {
                const prompts = get(promptsAtomFamily(revIdForPrompts))
                const list = (prompts as any[]) || []
                const property =
                    findPropertyInObject(list, propertyId) ||
                    findPropertyById(list as any, propertyId)
                if (property) {
                    return {
                        value: (property as any)?.content?.value || (property as any)?.value,
                        source: "variant" as const,
                        property,
                    } as any
                }

                // Fallback: try custom properties derived from OpenAPI spec
                const variant = getEnhancedRevisionById(get as any, revIdForPrompts)
                if (variant) {
                    const customProps = get(customPropertiesByRevisionAtomFamily(revIdForPrompts))
                    const values = Object.values(customProps || {}) as any[]
                    const node = values.find((n) => n?.__id === propertyId)
                    if (node) {
                        return {
                            value: (node as any)?.content?.value ?? (node as any)?.value,
                            source: "variant",
                            property: node,
                        } as any
                    }
                }
            }
            return null as any
        })
    }, [actualVariantId, propertyId])

    const propertyMetadataAtom = useMemo(() => {
        if (!propertyId) return nullMetadataAtom
        return atom((get) => {
            const revIdForPrompts = actualVariantId
            if (revIdForPrompts) {
                const prompts = get(promptsAtomFamily(revIdForPrompts))
                const list = (prompts as any[]) || []
                const property =
                    findPropertyInObject(list, propertyId) ||
                    findPropertyById(list as any, propertyId)
                if (property?.__metadata) return getMetadataLazy(property.__metadata)

                // Fallback: custom properties metadata
                const variant = getEnhancedRevisionById(get as any, revIdForPrompts)
                if (variant) {
                    const customProps = get(customPropertiesByRevisionAtomFamily(revIdForPrompts))
                    const values = Object.values(customProps || {}) as any[]
                    const node = values.find((n) => n?.__id === propertyId)
                    if (node?.__metadata) return getMetadataLazy(node.__metadata)
                }
            }
            // Synthesize minimal metadata for string inputs when nothing found
            return {type: "string", title: propertyId} as any
        })
    }, [actualVariantId, propertyId])

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

    if (providerNode && providerNode.__metadata) {
        const providerMetadata = getMetadataLazy(providerNode.__metadata)
        if (providerMetadata) {
            propertyMetadata = providerMetadata
        }
    }

    // Prompts-only write facade for variant updates
    const variantPromptWriteAtom = useMemo(() => {
        if (!actualVariantId || !propertyId) return noopWriteAtom
        return promptPropertyAtomFamily({revisionId: actualVariantId, propertyId})
    }, [actualVariantId, propertyId])
    const setVariantPromptValue = useSetAtom(variantPromptWriteAtom)

    const property = useMemo(() => {
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
            // No-op guard: skip if value hasn't changed to avoid redundant atom writes

            let _value = newValue
            // if newValue is instance of change event, then get the value properly
            const extractEventValue = (input: any) => {
                if (!input || typeof input !== "object") return undefined
                const target = (input as any).target ?? (input as any).currentTarget
                const candidate = target && typeof target === "object" ? target : null
                if (candidate && "value" in candidate) return (candidate as any).value
                if ("nativeEvent" in (input as any)) {
                    const nativeTarget = (input as any)?.nativeEvent?.target
                    if (nativeTarget && typeof nativeTarget === "object" && "value" in nativeTarget)
                        return (nativeTarget as any).value
                }
                return undefined
            }

            if (typeof Event !== "undefined" && newValue instanceof Event) {
                _value = (newValue as any).target?.value
            } else {
                const syntheticVal = extractEventValue(newValue)
                if (syntheticVal !== undefined) {
                    _value = syntheticVal
                }
            }

            const currentVal = value
            const isSame =
                typeof _value === "object" && _value !== null
                    ? deepEqual(_value, currentVal)
                    : _value === currentVal

            if (isSame) return

            if (source === "variant" && actualVariantId) {
                // Use prompts-only facade to route writes through the centralized mutation
                setVariantPromptValue(_value)
            }
        }

        return {
            __metadata: propertyMetadata && propertyMetadata, // already precomputed metadata
            value,
            handleChange: handler,
        }
    }, [propertyData, propertyMetadata, propertyId, rowId, actualVariantId, messageId])

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
