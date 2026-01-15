/**
 * EntitySelectorModal Component
 *
 * A modal for selecting entities with support for multiple entity types via tabs.
 * Integrates with the entitySelectorController for promise-based selection.
 */

import React, {useMemo, useCallback} from "react"

import {Modal, Tabs} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {resolveAdapter} from "../adapters/createAdapter"
import {
    entitySelectorOpenAtom,
    entitySelectorTitleAtom,
    entitySelectorActiveTypeAtom,
    entitySelectorAdaptersAtom,
    closeEntitySelectorWithSelectionAtom,
    closeEntitySelectorAtom,
    setEntitySelectorActiveTypeAtom,
} from "../state/modalState"
import type {EntitySelectionResult, SelectableEntityType} from "../types"

import {EntityPicker} from "./EntityPicker"

// ============================================================================
// TYPES
// ============================================================================

export interface EntitySelectorModalProps {
    /**
     * Additional modal width
     * @default 600
     */
    width?: number

    /**
     * Modal z-index
     */
    zIndex?: number

    /**
     * Whether to mask the background
     * @default true
     */
    mask?: boolean

    /**
     * Whether to close on mask click
     * @default true
     */
    maskClosable?: boolean

    /**
     * Whether to center the modal vertically
     * @default true
     */
    centered?: boolean

    /**
     * Additional CSS class for modal
     */
    className?: string

    /**
     * Custom footer (null to hide)
     */
    footer?: React.ReactNode | null
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Modal for entity selection with tab support
 *
 * This component reads its configuration from the entitySelectorController.
 * Use openEntitySelectorAtom to open the modal with a configuration.
 *
 * @example
 * ```tsx
 * // In your app
 * <EntitySelectorModal width={700} centered />
 *
 * // In a component
 * const openSelector = useSetAtom(openEntitySelectorAtom)
 *
 * const handleClick = async () => {
 *   const selection = await openSelector({
 *     title: 'Add to Playground',
 *     allowedTypes: ['appRevision', 'evaluatorRevision'],
 *     adapters: [appRevisionAdapter, evaluatorRevisionAdapter],
 *   })
 *
 *   if (selection) {
 *     console.log('Selected:', selection)
 *   }
 * }
 * ```
 */
export function EntitySelectorModal({
    width = 600,
    zIndex,
    mask = true,
    maskClosable = true,
    centered = true,
    className,
    footer = null,
}: EntitySelectorModalProps) {
    // Read modal state
    const isOpen = useAtomValue(entitySelectorOpenAtom)
    const title = useAtomValue(entitySelectorTitleAtom)
    const activeType = useAtomValue(entitySelectorActiveTypeAtom)
    const adapters = useAtomValue(entitySelectorAdaptersAtom)

    // Actions
    const closeWithSelection = useSetAtom(closeEntitySelectorWithSelectionAtom)
    const close = useSetAtom(closeEntitySelectorAtom)
    const setActiveType = useSetAtom(setEntitySelectorActiveTypeAtom)

    // Build tab items from adapters
    const tabItems = useMemo(() => {
        if (!adapters || adapters.length === 0) return []

        return adapters.map((adapterOrName) => {
            const adapter = resolveAdapter(adapterOrName)
            return {
                key: adapter.entityType,
                label: formatEntityTypeLabel(adapter.entityType),
                children: (
                    <EntityPicker
                        adapter={adapter}
                        onSelect={(selection) =>
                            closeWithSelection(selection as EntitySelectionResult)
                        }
                        showSearch
                        showBreadcrumb
                        showBackButton
                        maxHeight={400}
                        rootLabel={formatEntityTypeLabel(adapter.entityType)}
                    />
                ),
            }
        })
    }, [adapters, closeWithSelection])

    // Handle tab change
    const handleTabChange = useCallback(
        (key: string) => {
            setActiveType(key as SelectableEntityType)
        },
        [setActiveType],
    )

    // Handle cancel
    const handleCancel = useCallback(() => {
        close()
    }, [close])

    // Don't render if no adapters configured
    if (adapters.length === 0 && isOpen) {
        return null
    }

    return (
        <Modal
            open={isOpen}
            title={title}
            onCancel={handleCancel}
            width={width}
            zIndex={zIndex}
            mask={mask}
            maskClosable={maskClosable}
            centered={centered}
            className={className}
            footer={footer}
            destroyOnClose
        >
            {tabItems.length > 1 ? (
                <Tabs
                    activeKey={activeType ?? tabItems[0]?.key}
                    onChange={handleTabChange}
                    items={tabItems}
                />
            ) : tabItems.length === 1 ? (
                tabItems[0].children
            ) : null}
        </Modal>
    )
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format entity type as human-readable label
 */
function formatEntityTypeLabel(type: SelectableEntityType): string {
    const labels: Record<SelectableEntityType, string> = {
        testset: "Testset",
        revision: "Revision",
        app: "App",
        variant: "Variant",
        appRevision: "App Revision",
        evaluator: "Evaluator",
        evaluatorVariant: "Evaluator Variant",
        evaluatorRevision: "Evaluator Revision",
    }

    return labels[type] ?? type
}
