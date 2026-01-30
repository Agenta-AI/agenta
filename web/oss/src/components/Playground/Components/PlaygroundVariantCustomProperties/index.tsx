import {memo, useCallback, useMemo} from "react"

import {
    revisionEnhancedCustomPropertiesAtomFamily,
    metadataAtom,
    ossAppRevisionSchemaQueryAtomFamily,
} from "@agenta/entities/ossAppRevision"
import {Collapse, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, getDefaultStore, useAtomValue, useSetAtom} from "jotai"
import {selectAtom} from "jotai/utils"

import {customPropertyIdsByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"

import {parameterUpdateMutationAtom} from "../../state/atoms/propertyMutations"
import {useStyles} from "../PlaygroundVariantConfigPrompt/styles"
import {renderMap} from "../PlaygroundVariantPropertyControl/assets/helpers"

import type {PlaygroundVariantCustomPropertiesProps} from "./types"

/**
 * PlaygroundVariantConfig manages the configuration interface for a single variant.
 *
 * Features:
 * - Displays variant configuration header
 * - Renders prompt configuration interface
 * - Handles styling for collapsed sections
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantConfig variantId="variant-123" />
 * ```
 */

const {Text} = Typography

const PlaygroundVariantCustomProperty = memo(
    ({variantId, viewOnly, id, customPropsRecord}: PlaygroundVariantCustomPropertyProps) => {
        // Use entity-level enhanced custom properties directly for proper reactivity
        const propertyAtom = useMemo(() => {
            return customPropsRecord
                ? atom(() => customPropsRecord[id])
                : selectAtom(
                      revisionEnhancedCustomPropertiesAtomFamily(variantId),
                      (state) => state[id],
                      deepEqual,
                  )
        }, [variantId, id, customPropsRecord])
        const customProperty = useAtomValue(propertyAtom)
        const updateParam = useSetAtom(parameterUpdateMutationAtom)

        // Try to get metadata from global metadataAtom first (for legacy/OSS transformer)
        const propertyMetadataAtom = useMemo(() => {
            return selectAtom(metadataAtom, (state) => state[customProperty?.__metadata], deepEqual)
        }, [customProperty])

        const globalMeta = useAtomValue(propertyMetadataAtom, {
            store: getDefaultStore(),
        })

        // Fallback to schema from entity-level derivation if global metadata not found
        const meta = useMemo(() => {
            if (globalMeta) return globalMeta
            // Use schema from entity-level EnhancedCustomProperty
            const schema = (customProperty as any)?.schema
            if (schema) {
                return {
                    type: schema.type,
                    title: schema.title || id,
                    description: schema.description,
                    default: schema.default,
                    minimum: schema.minimum,
                    maximum: schema.maximum,
                    enum: schema.enum,
                }
            }
            return null
        }, [globalMeta, customProperty, id])

        const type: string | undefined = (meta && (meta as any).type) || undefined
        const renderer = type ? (renderMap as any)[type as keyof typeof renderMap] : undefined

        const handleChange = useCallback(
            (newValue: any, _arg?: any, subPropertyId?: string) => {
                const pid = subPropertyId || (customProperty as any)?.__id
                if (process.env.NODE_ENV === "development") {
                    console.debug("[CustomProps][Mut][UI]", {
                        variantId,
                        propertyId: pid,
                        newValue,
                    })
                }
                updateParam({
                    event: newValue,
                    propertyId: pid,
                    variantId,
                })
            },
            [variantId, updateParam],
        )

        // Debug logging
        if (process.env.NODE_ENV === "development") {
            console.info("[PlaygroundVariantCustomProperty] METADATA LOOKUP", {
                id,
                variantId,
                metadataHash: (customProperty as any)?.__metadata,
                globalMeta,
                meta,
                type,
                hasRenderer: !!renderer,
                customPropertyKeys: customProperty ? Object.keys(customProperty as object) : [],
            })
            console.info("[PlaygroundVariantCustomProperty]", {
                id,
                variantId,
                hasCustomProperty: !!customProperty,
                customPropertyValue: (customProperty as any)?.value,
                customPropertySchema: (customProperty as any)?.schema,
                meta,
                type,
                hasRenderer: !!renderer,
            })
        }

        if (!customProperty) {
            return null
        }

        if (renderer) {
            const key =
                (customProperty?.__test || (customProperty as any))?.__id ||
                String(meta?.title || Math.random())
            return (
                <div key={key}>
                    {renderer({
                        withTooltip: true,
                        metadata: meta,
                        key: customProperty?.__test,
                        value: (customProperty as any)?.value,
                        disabled: viewOnly,
                        propertyId: (customProperty as any)?.__id,
                        variantId,
                        handleChange: handleChange,
                    })}
                </div>
            )
        }
        return <Typography.Text key={id}>Unknown type</Typography.Text>
    },
)

const PlaygroundVariantCustomProperties: React.FC<PlaygroundVariantCustomPropertiesProps> = ({
    variantId,
    className,
    initialOpen,
    viewOnly = false,
    customPropsRecord: providedCustomProps,
}) => {
    const classes = useStyles()

    // Subscribe directly to schema query to ensure re-render when async data arrives
    // This is the root subscription that triggers downstream atom updates
    const schemaQuery = useAtomValue(ossAppRevisionSchemaQueryAtomFamily(variantId))

    // Derive custom properties from spec + saved params using new selector
    const atomCustomPropertyIds = useAtomValue(customPropertyIdsByRevisionAtomFamily(variantId))

    console.log("[UI] PlaygroundVariantCustomProperties render", {
        variantId,
        atomCustomPropertyIds,
        atomCustomPropertyIdsLength: atomCustomPropertyIds?.length,
        schemaQueryPending: schemaQuery.isPending,
        schemaQueryHasData: !!schemaQuery.data?.agConfigSchema,
    })

    const customPropertyIds = useMemo(() => {
        return providedCustomProps ? Object.keys(providedCustomProps) : atomCustomPropertyIds
    }, [providedCustomProps, atomCustomPropertyIds])

    const hasCustomProperties = customPropertyIds.length > 0

    const items = useMemo(() => {
        return hasCustomProperties
            ? [
                  {
                      key: "1",
                      classNames: {
                          body: "!border-t-0 !pt-0",
                          header: "z-10",
                      },
                      label: (
                          <div
                              className={clsx(
                                  "w-full flex items-center justify-between px-2.5 !p-0",
                                  className,
                              )}
                          >
                              <Text className="capitalize">Custom Properties</Text>
                          </div>
                      ),
                      children: (
                          <div
                              className={clsx(
                                  "flex flex-col gap-2 pt-3",
                                  "[&_.playground-property-control.multi-select-control]:!flex-row",
                                  "[&_.playground-property-control.multi-select-control]:!items-center",
                                  "[&_.playground-property-control.multi-select-control]:!justify-between",
                                  "[&_.playground-property-control.multi-select-control_.ant-select]:!grow",
                                  "[&_.playground-property-control.multi-select-control_.ant-select]:!max-w-[250px]",
                              )}
                          >
                              {customPropertyIds.map((customPropertyId) => {
                                  return (
                                      <PlaygroundVariantCustomProperty
                                          key={customPropertyId}
                                          variantId={variantId}
                                          id={customPropertyId}
                                          viewOnly={viewOnly}
                                          customPropsRecord={providedCustomProps}
                                      />
                                  )
                              })}
                          </div>
                      ),
                  },
              ]
            : []
    }, [
        hasCustomProperties,
        customPropertyIds,
        variantId,
        className,
        viewOnly,
        providedCustomProps,
    ])

    // Render empty fragment to maintain atom subscription while loading
    // This ensures the component stays mounted and re-renders when async schema loads
    if (!hasCustomProperties) {
        return <></>
    }

    return (
        <Collapse
            ghost
            className={clsx("rounded-none", className, classes.collapseContainer)}
            bordered={false}
            defaultActiveKey={initialOpen ? "1" : undefined}
            items={items}
        />
    )
}

export default memo(PlaygroundVariantCustomProperties)
