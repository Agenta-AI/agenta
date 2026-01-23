/**
 * @module SharedEditor
 *
 * A flexible editor wrapper with support for both rich text and code editing.
 * Built on top of the Editor component.
 *
 * @example
 * ```tsx
 * import {SharedEditor} from '@agenta/ui'
 *
 * <SharedEditor
 *   initialValue="Hello World"
 *   handleChange={(value) => console.log(value)}
 * />
 * ```
 */

export {default as SharedEditor} from "./SharedEditor"
export type {SharedEditorProps, BaseContainerProps} from "./types"

// Re-export useDebounceInput from @agenta/shared
export {useDebounceInput} from "@agenta/shared"
