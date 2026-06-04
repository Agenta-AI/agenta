/**
 * View-types subpath — render-mode vocabulary + components for the playground
 * input UX and the testcase drawer.
 *
 * Import via:
 *   import {ViewTypeSelect, FormView, getViewOptions} from "@agenta/entity-ui/view-types"
 *
 * See `viewTypes.ts` for the conceptual model: type chip = inferred kind
 * (granular, via `@agenta/shared` + `@agenta/ui` TypeChip); view-as dropdown
 * = render mode (this module, 6-way).
 */

export {
    buildEmptyShapeFromSchema,
    detectFieldKind,
    detectNestedKind,
    getDefaultViewForExpectedType,
    getDefaultViewForValue,
    getViewOptions,
    getViewOptionsForExpectedType,
    isChatMessagesArray,
    type ExpectedType,
    type FieldKind,
    type NestedKind,
    type ViewOption,
    type ViewType,
} from "./viewTypes"

export {ViewTypeSelect} from "./ViewTypeSelect"
export {FormView} from "./FormView"

export {
    coerceTextEdit,
    inferLogicalType,
    parseJsonEdit,
    parseYamlEdit,
    valueToDisplay,
    type LogicalType,
} from "./formatters"
