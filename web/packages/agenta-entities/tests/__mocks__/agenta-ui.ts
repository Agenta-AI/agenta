/**
 * Lightweight stub for @agenta/ui used in Vitest node-env tests.
 *
 * The real @agenta/ui pulls in antd which is enormous and causes the Vitest
 * transformer to time out. Our entity tests only exercise Jotai atoms — they
 * never render React components — so returning no-op stubs here is safe.
 */

export const InitialsAvatar = () => null

// Add additional no-op exports here if other @agenta/ui symbols are imported
// by entity source files in the future.
export const cn = (...args: unknown[]) => args.filter(Boolean).join(" ")
export const textColors = {}
export const bgColors = {}
export const EnhancedModal = () => null
export const ModalContent = () => null
export const ModalFooter = () => null
