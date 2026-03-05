import {memo, useMemo} from "react"

import {legacyAppRevisionEntityWithBridgeAtomFamily} from "@agenta/entities/legacyAppRevision"
import {
    getMetadataLazy,
    metadataSelectorFamily,
    getAllMetadata,
} from "@agenta/entities/legacyAppRevision"
import {Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {
    moleculeBackedPromptsAtomFamily,
    moleculeBackedCustomPropertiesAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"

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
    const actualVariantId = useMemo(
        () => (typeof variantId === "object" ? (variantId as any).id : variantId),
        [variantId],
    )

    // ATOM-LEVEL: compute selector atoms (stable via useMemo), no conditional hooks
    // Use molecule-backed atoms for single source of truth
    const propertyValueAtom = useMemo(() => {
        if (!propertyId) return nullValueAtom
        // Prompt-only: find property in prompts or custom properties for the given revision
        return atom((get) => {
            const revIdForPrompts = actualVariantId
            if (revIdForPrompts) {
                const prompts = get(moleculeBackedPromptsAtomFamily(revIdForPrompts))
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
                const variant = get(legacyAppRevisionEntityWithBridgeAtomFamily(revIdForPrompts))
                if (variant) {
                    const customProps = get(
                        moleculeBackedCustomPropertiesAtomFamily(revIdForPrompts),
                    )
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
            const resolveMetadata = (metaRef: any) => {
                if (!metaRef) return null
                if (typeof metaRef === "string") {
                    return (get(metadataSelectorFamily(metaRef)) as any) || getMetadataLazy(metaRef)
                }
                return metaRef
            }

            const revIdForPrompts = actualVariantId
            let foundProperty: any = null
            if (revIdForPrompts) {
                // Use molecule-backed prompts for single source of truth
                const prompts = get(moleculeBackedPromptsAtomFamily(revIdForPrompts))
                const list = (prompts as any[]) || []
                const metadataMap = getAllMetadata() as Record<string, any>
                const property =
                    findPropertyInObject(list, propertyId) ||
                    findPropertyById(list as any, propertyId)
                foundProperty = property
                const propertyMetadata = resolveMetadata(property?.__metadata)

                if (propertyMetadata) return propertyMetadata
                if (property?.__metadata) {
                    const meta = metadataMap?.[property.__metadata]
                    return meta ?? getMetadataLazy(property.__metadata)
                }

                // Fallback: custom properties metadata (molecule-backed)
                const variant = get(legacyAppRevisionEntityWithBridgeAtomFamily(revIdForPrompts))
                if (variant) {
                    const customProps = get(
                        moleculeBackedCustomPropertiesAtomFamily(revIdForPrompts),
                    )
                    const values = Object.values(customProps || {}) as any[]
                    const node = values.find((n) => n?.__id === propertyId)
                    if (node) foundProperty = node
                    const customMetadata = resolveMetadata(node?.__metadata)
                    if (customMetadata) return customMetadata
                    if (node?.__metadata) {
                        const meta = metadataMap?.[node.__metadata]
                        return meta ?? getMetadataLazy(node.__metadata)
                    }
                }
            }
            // Synthesize minimal metadata for string inputs when nothing found.
            // Use __name from the property (human-readable) when available,
            // falling back to propertyId only as last resort.
            const fallbackTitle = foundProperty?.__name || foundProperty?.key || propertyId
            return {type: "string", title: fallbackTitle} as any
        })
    }, [actualVariantId, propertyId])

    // Subscribe to unified property data (handles both variant and generation data)
    let propertyData = useAtomValue(propertyValueAtom)
    let propertyMetadata = useAtomValue(propertyMetadataAtom)

    // Prompts-only write facade for variant updates
    const variantPromptWriteAtom = useMemo(() => {
        if (!actualVariantId || !propertyId) return noopWriteAtom
        return promptPropertyAtomFamily({revisionId: actualVariantId, propertyId})
    }, [actualVariantId, propertyId])
    const setVariantPromptValue = useSetAtom(variantPromptWriteAtom)

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

    const property = useMemo(() => {
        if (!propertyData && propertyMetadata) {
            return {
                __metadata: propertyMetadata,
                value: propsValue,
                handleChange: (next: any) => {
                    setVariantPromptValue(next)
                },
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
    }, [
        propertyData,
        propertyMetadata,
        propertyId,
        rowId,
        actualVariantId,
        messageId,
        propsValue,
        setVariantPromptValue,
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
