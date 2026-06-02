/**
 * `@agenta/playground-ui/playground-inputs-body` — public exports.
 *
 *   import {PlaygroundInputsBody} from "@agenta/playground-ui/playground-inputs-body"
 *
 * Used by the OSS playground (Step 6) to replace the current per-variable
 * `VariableControlAdapter` rendering with type-aware cards composed from
 * `@agenta/entity-ui/view-types` primitives. See the approved design doc
 * (`~/.gstack/projects/Agenta-AI-agenta/...-playground-mustache-input-ux-*`).
 */

export {PlaygroundInputsBody} from "./PlaygroundInputsBody"
export type {PlaygroundInputsBodyProps, PlaygroundInputsBodyVariable} from "./PlaygroundInputsBody"

export {PlaygroundInputsBodyHost} from "./PlaygroundInputsBodyHost"
export type {PlaygroundInputsBodyHostProps} from "./PlaygroundInputsBodyHost"

export {VariableCard} from "./VariableCard"
export {UnreferencedColumnsFooter} from "./UnreferencedColumnsFooter"

export {variableViewModeAtomFamily} from "./viewModeAtoms"
export type {VariableViewModeKey} from "./viewModeAtoms"

// Convenience re-exports — same symbols are also available directly from
// `@agenta/entity-ui/view-types`. Surfaced here so consumers integrating
// the playground inputs body have a single import site.
export {
    coerceTextEdit,
    inferLogicalType,
    parseJsonEdit,
    parseYamlEdit,
    valueToDisplay,
    type LogicalType,
} from "@agenta/entity-ui/view-types"
