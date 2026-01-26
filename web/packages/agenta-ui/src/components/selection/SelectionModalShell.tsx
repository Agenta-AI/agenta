/**
 * SelectionModalShell Component
 *
 * A modal shell for selection interfaces with a picker panel on the left,
 * main content on the right, and optional footer. Built on EnhancedModal
 * and ModalContentLayout for consistent styling.
 *
 * Common use cases:
 * - Entity selection modals (testset picker + table preview)
 * - Configuration modals (navigation + settings)
 * - Multi-step selection flows
 *
 * @example
 * ```tsx
 * import { SelectionModalShell } from '@agenta/ui'
 *
 * <SelectionModalShell
 *   open={isOpen}
 *   onCancel={handleClose}
 *   title="Select Testset"
 *   picker={<TestsetPicker onSelect={handleSelect} />}
 *   content={<TestcaseTable testsetId={selectedId} />}
 *   footer={
 *     <>
 *       <Button onClick={handleClose}>Cancel</Button>
 *       <Button type="primary" onClick={handleConfirm}>Confirm</Button>
 *     </>
 *   }
 * />
 * ```
 */

import type {ReactNode} from "react"

import {modalSizes, layoutSizes} from "../../utils/styles"
import {EnhancedModal, type EnhancedModalProps} from "../EnhancedModal"
import {ModalContentLayout} from "../presentational/layout/ModalContentLayout"

// ============================================================================
// TYPES
// ============================================================================

export type SelectionModalSize = "small" | "medium" | "large"

export interface SelectionModalShellProps extends Omit<EnhancedModalProps, "children" | "styles"> {
    /**
     * Left panel content (picker, navigation, steps)
     */
    picker: ReactNode

    /**
     * Main content area (table, form, preview)
     */
    content: ReactNode

    /**
     * Optional footer content (buttons, summary)
     * Rendered below the split layout with a top border
     */
    footer?: ReactNode

    /**
     * Preset modal size
     * @default "large"
     */
    size?: SelectionModalSize

    /**
     * Custom width override (takes precedence over size preset)
     */
    width?: number

    /**
     * Custom height override (takes precedence over size preset)
     */
    height?: number | string

    /**
     * Width of the picker panel in pixels
     * @default 320 (layoutSizes.sidebarWide)
     */
    pickerWidth?: number

    /**
     * Padding for the picker panel
     * @default "p-4"
     */
    pickerPadding?: string

    /**
     * Padding for the content panel
     * @default "p-4"
     */
    contentPadding?: string
}

// ============================================================================
// SIZE PRESETS
// ============================================================================

const SIZE_PRESETS: Record<SelectionModalSize, {width: number; height: number | string}> = {
    small: {width: modalSizes.small.width, height: modalSizes.small.height},
    medium: {width: modalSizes.medium.width, height: modalSizes.medium.height},
    large: {width: modalSizes.large.width, height: modalSizes.large.height},
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * SelectionModalShell
 *
 * A modal wrapper optimized for selection interfaces with a two-panel layout.
 *
 * Features:
 * - Consistent sizing via presets or custom dimensions
 * - Left picker panel + right content area layout
 * - Optional footer for actions
 * - Inherits EnhancedModal features (lazy rendering, auto-height)
 */
export function SelectionModalShell({
    picker,
    content,
    footer,
    size = "large",
    width: customWidth,
    height: customHeight,
    pickerWidth = layoutSizes.sidebarWide,
    pickerPadding,
    contentPadding,
    ...modalProps
}: SelectionModalShellProps) {
    const preset = SIZE_PRESETS[size]
    const effectiveWidth = customWidth ?? preset.width
    const effectiveHeight = customHeight ?? preset.height

    return (
        <EnhancedModal
            {...modalProps}
            width={effectiveWidth}
            footer={null}
            styles={{
                body: {
                    height: effectiveHeight,
                    maxHeight: effectiveHeight,
                    padding: 0,
                    overflow: "hidden",
                    flex: "none",
                },
            }}
        >
            <ModalContentLayout
                picker={picker}
                content={content}
                footer={footer}
                pickerWidth={pickerWidth}
                pickerPadding={pickerPadding}
                contentPadding={contentPadding}
            />
        </EnhancedModal>
    )
}

export default SelectionModalShell
