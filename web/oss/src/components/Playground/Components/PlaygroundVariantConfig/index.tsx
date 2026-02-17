"use client"

import {memo, useMemo} from "react"

import {playgroundController} from "@agenta/playground"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {PlaygroundConfigSection} from "@agenta/entity-ui"

import BaseRunnableConfigSection from "./assets/BaseRunnableConfigSection"
import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import type {VariantConfigComponentProps} from "./types"

/**
 * PlaygroundVariantConfig manages the configuration interface for a single variant.
 *
 * Routes to entity-type specific config sections:
 * - legacyAppRevision: PlaygroundConfigSection (schema-driven)
 * - baseRunnable: BaseRunnableConfigSection (read-only key-value display)
 */

const PlaygroundVariantConfig: React.FC<
    VariantConfigComponentProps & {
        embedded?: boolean
        variantNameOverride?: string
        revisionOverride?: number | string | null
    }
> = ({variantId, className, embedded, variantNameOverride, revisionOverride, ...divProps}) => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const entityType = nodes.find((n) => n.entityId === variantId)?.entityType

    if (entityType === "baseRunnable") {
        return (
            <div className={clsx("w-full", "relative", "flex flex-col", className)} {...divProps}>
                <BaseRunnableConfigSection entityId={variantId} />
            </div>
        )
    }

    return (
        <div
            className={clsx(
                "w-full",
                "relative",
                "flex flex-col",
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
            <PlaygroundConfigSection revisionId={variantId} />
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
