/**
 * DrillInView Module
 *
 * Molecule-first drill-in navigation for entities.
 *
 * This module provides:
 * - React components for drill-in navigation
 * - Types for molecule-level drillIn configuration
 * - ClassNames API for styling customization
 * - Context for component state management
 * - Slot types for custom rendering
 *
 * @example
 * ```tsx
 * import {
 *   MoleculeDrillInView,
 *   useDrillIn,
 *   type DrillInMoleculeConfig
 * } from '@agenta/entities/ui'
 *
 * // Use the view component
 * <MoleculeDrillInView
 *   molecule={myMoleculeAdapter}
 *   entityId={id}
 *   classNames={{ root: 'my-root' }}
 *   slots={{ fieldHeader: CustomHeader }}
 * />
 *
 * // Or use the hook in custom components
 * function MyCustomField() {
 *   const { entity, updateValue } = useDrillIn()
 *   return <div>...</div>
 * }
 * ```
 */

// ============================================================================
// COMPONENTS
// ============================================================================

export {
    MoleculeDrillInView,
    MoleculeDrillInBreadcrumb,
    MoleculeDrillInFieldList,
    MoleculeDrillInFieldItem,
    useDrillIn,
    MoleculeDrillInProvider,
} from "./components"
export type {MoleculeDrillInProviderProps} from "./components"

// ============================================================================
// TYPES
// ============================================================================

export type {
    // Molecule-level config
    DrillInMoleculeConfig,
    DrillInDisplayConfig,
    DrillInFieldBehaviors,
    DrillInRenderers,
    FieldRendererProps,
    // ClassNames
    DrillInClassNames,
    DrillInStyles,
    DrillInStateClassNames,
    // Slots
    DrillInSlots,
    BreadcrumbSlotProps,
    FieldHeaderSlotProps,
    FieldContentSlotProps,
    FieldActionsSlotProps,
    EmptySlotProps,
    // Component props
    MoleculeDrillInViewProps,
    MoleculeDrillInAdapter,
} from "./types"

// ============================================================================
// UTILS
// ============================================================================

export {
    // ClassNames
    drillInPrefixCls,
    defaultClassNames,
    defaultStateClassNames,
    mergeClassNames,
    buildClassName,
    createClassNameBuilder,
    useDrillInClassNames,
    // Adapters
    createMoleculeDrillInAdapter,
    createReadOnlyDrillInAdapter,
    createEditableDrillInAdapter,
    type AdaptableMolecule,
    type CreateAdapterOptions,
} from "./utils"

// ============================================================================
// CONTEXT
// ============================================================================

export type {DrillInContextValue, DrillInProviderProps} from "./context"

export {defaultFieldBehaviors} from "./context"
