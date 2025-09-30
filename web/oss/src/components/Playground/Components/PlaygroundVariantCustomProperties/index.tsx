import {memo, useCallback, useEffect, useMemo} from "react"

import {Collapse, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, getDefaultStore, useAtomValue, useSetAtom} from "jotai"
import {selectAtom} from "jotai/utils"

import {getMetadataLazy, metadataAtom} from "@/oss/lib/hooks/useStatelessVariants/state"
import {
    customPropertiesByRevisionAtomFamily,
    customPropertyIdsByRevisionAtomFamily,
} from "@/oss/state/newPlayground/core/customProperties"

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
        const propertyAtom = useMemo(() => {
            return customPropsRecord
                ? atom(() => customPropsRecord[id])
                : selectAtom(
                      customPropertiesByRevisionAtomFamily(variantId),
                      (state) => state[id],
                      deepEqual,
                  )
        }, [variantId, id, customPropsRecord])
        const customProperty = useAtomValue(propertyAtom)
        const updateParam = useSetAtom(parameterUpdateMutationAtom)

        const propertyMetadataAtom = useMemo(() => {
            return selectAtom(metadataAtom, (state) => state[customProperty?.__metadata], deepEqual)
        }, [customProperty])

        const meta = useAtomValue(propertyMetadataAtom, {
            store: getDefaultStore(),
        })

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
    const updateParam = useSetAtom(parameterUpdateMutationAtom)

    // Derive custom properties from spec + saved params using new selector
    const atomCustomPropertyIds = useAtomValue(customPropertyIdsByRevisionAtomFamily(variantId))
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
        updateParam,
        providedCustomProps,
    ])

    return hasCustomProperties ? (
        <Collapse
            ghost
            className={clsx("rounded-none", className, classes.collapseContainer)}
            bordered={false}
            defaultActiveKey={initialOpen ? "1" : undefined}
            items={items}
        />
    ) : null
}

export default memo(PlaygroundVariantCustomProperties)
