/**
 * Lightweight stub for @agenta/ui used in Vitest node-env tests.
 *
 * The real @agenta/ui pulls in antd, which is enormous and causes the Vitest
 * transformer to time out. The annotation integration tests only exercise the
 * testset HTTP API functions and pure helpers — they never render React — so
 * returning no-op stubs here is safe.
 */

export const InitialsAvatar = () => null
export const cn = (...args: unknown[]) => args.filter(Boolean).join(" ")
export const textColors = {}
export const bgColors = {}
export const EnhancedModal = () => null
export const ModalContent = () => null
export const ModalFooter = () => null
