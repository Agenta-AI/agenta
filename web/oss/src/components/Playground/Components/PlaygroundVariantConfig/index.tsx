"use client"

import {memo} from "react"

import clsx from "clsx"

import PlaygroundVariantConfigEditors from "./assets/Editors"
import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import type {VariantConfigComponentProps} from "./types"

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

const PlaygroundVariantConfig: React.FC<
    VariantConfigComponentProps & {
        embedded?: boolean
        variantNameOverride?: string
        revisionOverride?: number | string | null
    }
> = ({variantId, className, embedded, variantNameOverride, revisionOverride, ...divProps}) => {
    return (
        <div
            className={clsx(
                "w-full",
                "relative",
                "flex flex-col",
                "[&_.ant-collapse]:!bg-[transparent]",
                "[&_.ant-collapse-expand-icon]:!self-center",
                "[&_.ant-collapse-content-box]:!px-4",
                "[&_.ant-collapse-header]:!pl-3 [&_.ant-collapse-header]:!pr-4",
                "[&_.ant-collapse-header]:!top-[48px] [&_.ant-collapse-header]:!z-[2]",
                "[&_.ant-collapse-header]:!sticky [&_.ant-collapse-header]:!bg-white",
                className,
            )}
            {...divProps}
        >
            <PlaygroundVariantConfigHeader
                variantId={variantId}
                embedded={embedded}
                variantNameOverride={variantNameOverride}
                revisionOverride={revisionOverride}
            />
            <PlaygroundVariantConfigEditors variantId={variantId} />
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
