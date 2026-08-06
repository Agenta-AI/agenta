/**
 * EnhancedModal Component
 *
 * A Modal wrapper that provides:
 * - Lazy rendering: content only mounts after first open
 * - Auto-contained height with internal scrolling (no window scroll)
 * - Smart style merging for container/body/footer
 * - Consistent defaults (centered, border radius, destroy on close)
 *
 * @example
 * ```tsx
 * import {EnhancedModal} from '@agenta/ui'
 *
 * <EnhancedModal
 *   open={isOpen}
 *   onCancel={handleClose}
 *   title="My Modal"
 *   footer={<MyFooter />}
 * >
 *   <MyContent />
 * </EnhancedModal>
 * ```
 */

import {useEffect, useState, useCallback} from "react"

import {Modal, type ModalProps} from "antd"

// ============================================================================
// TYPES
// ============================================================================

export interface EnhancedModalStyles {
    container?: React.CSSProperties
    body?: React.CSSProperties
    footer?: React.CSSProperties
    header?: React.CSSProperties
    mask?: React.CSSProperties
    content?: React.CSSProperties
    wrapper?: React.CSSProperties
}

export interface EnhancedModalProps extends Omit<ModalProps, "styles"> {
    children?: React.ReactNode
    /**
     * Custom styles for modal parts.
     * Can be an object or a function that receives props.
     */
    styles?: EnhancedModalStyles | ((context: {props: EnhancedModalProps}) => EnhancedModalStyles)
    /**
     * Maximum height of the modal container.
     * Set to `undefined` to disable auto-height.
     * @default "90vh"
     */
    maxHeight?: string | undefined
    /**
     * Whether to enable lazy rendering (only mount content after first open).
     * @default true
     */
    lazyRender?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * EnhancedModal
 *
 * Wraps Ant Design Modal with performance optimizations and UX improvements.
 *
 * Features:
 * - **Lazy rendering**: Content only mounts after the modal opens for the first time,
 *   avoiding Ant Design's eager portal rendering.
 * - **Auto-contained height**: Caps height at 90vh by default with internal scrolling,
 *   so the window itself doesn't scroll.
 * - **Smart style merging**: Custom styles are merged intelligently with defaults.
 * - **Cleanup on hide**: Resets render state after afterClose.
 */
export function EnhancedModal({
    children,
    open,
    afterClose,
    styles: customStyles,
    maxHeight = "90vh",
    lazyRender = true,
    ...props
}: EnhancedModalProps) {
    const [shouldRender, setShouldRender] = useState(false)

    // Enable rendering when modal opens
    useEffect(() => {
        if (open) {
            setShouldRender(true)
        }
    }, [open])

    const handleAfterClose = useCallback(() => {
        afterClose?.()
        if (lazyRender) {
            setShouldRender(false)
        }
    }, [afterClose, lazyRender])

    // Don't render until first open (if lazy rendering is enabled)
    if (lazyRender && !shouldRender) {
        return null
    }

    // Resolve custom styles (can be object or function)
    const resolvedCustomStyles =
        typeof customStyles === "function"
            ? customStyles({
                  props: {
                      children,
                      open,
                      afterClose,
                      styles: customStyles,
                      maxHeight,
                      lazyRender,
                      ...props,
                  },
              })
            : customStyles

    // Separate style parts to avoid override conflicts
    const {
        container: customContainer,
        body: customBody,
        footer: customFooter,
        ...otherCustomStyles
    } = resolvedCustomStyles || {}

    return (
        <Modal
            open={open}
            afterClose={handleAfterClose}
            centered
            destroyOnHidden
            {...props}
            style={{borderRadius: 16, ...props.style}}
            styles={{
                container: {
                    display: "flex",
                    flexDirection: "column",
                    // Only apply maxHeight if not explicitly overridden
                    ...(maxHeight && customContainer?.maxHeight === undefined ? {maxHeight} : {}),
                    ...customContainer,
                },
                body: {
                    overflowY: "auto",
                    flex: 1,
                    minHeight: 0,
                    ...customBody,
                },
                footer: {
                    flexShrink: 0,
                    ...customFooter,
                },
                ...otherCustomStyles,
            }}
        >
            {children}
        </Modal>
    )
}

export default EnhancedModal
