import {useCallback, memo, useMemo} from "react"

import {Collapse, Typography} from "antd"
import clsx from "clsx"

import type {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
import usePlayground from "../../hooks/usePlayground"
import {useStyles} from "../PlaygroundVariantConfigPrompt/styles"
import PlaygroundVariantPropertyControl from "../PlaygroundVariantPropertyControl"

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

const PlaygroundVariantCustomProperties: React.FC<PlaygroundVariantCustomPropertiesProps> = ({
    variantId,
    className,
    initialOpen,
}) => {
    const classes = useStyles()
    const {customProperties, hasCustomProperties} = usePlayground({
        variantId,
        variantSelector: useCallback((variant: EnhancedVariant) => {
            const customProperties = Object.values(variant?.customProperties || {})
            return {customProperties, hasCustomProperties: Object.keys(customProperties).length > 0}
        }, []),
    })

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
                              {customProperties.map((customProperty) => {
                                  return (
                                      <PlaygroundVariantPropertyControl
                                          key={customProperty.__id}
                                          propertyId={customProperty.__id}
                                          variantId={variantId}
                                          withTooltip={true}
                                      />
                                  )
                              })}
                          </div>
                      ),
                  },
              ]
            : []
    }, [hasCustomProperties, customProperties, variantId, className])

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
