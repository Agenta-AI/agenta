import {vi} from "vitest"

/** `@agenta/ui/app-message` for node-env tests: spies, no antd. */
export const message = {success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn()}
