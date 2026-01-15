/**
 * MoleculeDrillInView Adapters
 *
 * Factory functions for creating MoleculeDrillInAdapter from molecules.
 * Simplifies the process of connecting molecules to MoleculeDrillInView.
 *
 * @example
 * ```typescript
 * import { createMoleculeDrillInAdapter } from '@agenta/entities/ui'
 * import { testcaseMolecule } from '@agenta/entities/testcase'
 *
 * // Create an adapter from the molecule
 * const testcaseAdapter = createMoleculeDrillInAdapter(testcaseMolecule)
 *
 * // Use with MoleculeDrillInView
 * <MoleculeDrillInView
 *   entityId={testcaseId}
 *   molecule={testcaseAdapter}
 * />
 * ```
 */

import type {DataPath} from "@agenta/shared"
import type {Atom, WritableAtom} from "jotai"

import type {
    MoleculeDrillInAdapter,
    DrillInMoleculeConfig,
    DrillInDisplayConfig,
    DrillInFieldBehaviors,
    DrillInRenderers,
} from "../types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Molecule shape expected by the adapter factory
 */
export interface AdaptableMolecule<TEntity, TDraft> {
    /** Atoms for subscriptions */
    atoms: {
        data: (id: string) => Atom<TEntity | null>
        draft: (id: string) => Atom<TDraft | null>
        isDirty: (id: string) => Atom<boolean>
    }

    /** Reducers for mutations */
    reducers: {
        update: WritableAtom<unknown, [id: string, changes: TDraft], void>
        discard: WritableAtom<unknown, [id: string], void>
    }

    /** DrillIn utilities */
    drillIn: {
        /** Get root data for navigation */
        getRootData: (entity: TEntity | null) => unknown
        /** Convert path changes to draft changes */
        getChangesFromRoot: (
            entity: TEntity | null,
            rootData: unknown,
            path: DataPath,
            value: unknown,
        ) => TDraft | null
        /** Value mode */
        valueMode?: "structured" | "string"
    }
}

/**
 * Options for creating the adapter
 */
export interface CreateAdapterOptions<TEntity> {
    /** Override display configuration */
    display?: DrillInDisplayConfig
    /** Override field behaviors */
    fields?: DrillInFieldBehaviors
    /** Custom renderers */
    renderers?: DrillInRenderers<TEntity>
}

// ============================================================================
// ADAPTER FACTORY
// ============================================================================

/**
 * Create a MoleculeDrillInAdapter from a molecule.
 *
 * This factory simplifies connecting molecules to MoleculeDrillInView by:
 * 1. Extracting the required atoms and reducers from the molecule
 * 2. Wrapping the drillIn utilities in the expected format
 * 3. Optionally applying custom display/field/renderer overrides
 *
 * @example
 * ```typescript
 * import { createMoleculeDrillInAdapter } from '@agenta/entities/ui'
 * import { testcaseMolecule } from '@agenta/entities/testcase'
 *
 * // Basic usage
 * const adapter = createMoleculeDrillInAdapter(testcaseMolecule)
 *
 * // With customization
 * const customAdapter = createMoleculeDrillInAdapter(testcaseMolecule, {
 *   fields: { editable: true, copyable: true },
 *   display: { valueMode: 'structured' },
 * })
 *
 * // Use in component
 * <MoleculeDrillInView entityId={id} molecule={adapter} />
 * ```
 */
export function createMoleculeDrillInAdapter<TEntity, TDraft>(
    molecule: AdaptableMolecule<TEntity, TDraft>,
    options?: CreateAdapterOptions<TEntity>,
): MoleculeDrillInAdapter<TEntity, TDraft> {
    const {display, fields, renderers} = options ?? {}

    // Build drillIn config from molecule + options
    const drillInConfig: DrillInMoleculeConfig<TEntity, TDraft> = {
        getRootData: molecule.drillIn.getRootData,
        getChangesFromRoot: (entity, rootData, path) => {
            // The molecule's getChangesFromRoot needs the value, but MoleculeDrillInView
            // will provide it differently. For now, we return a partial that the view
            // will use with its own value.
            // The actual value will be provided when onValueChange is called.
            return {} as TDraft
        },
        display: display ?? {
            valueMode: molecule.drillIn.valueMode ?? "structured",
        },
        fields,
        renderers,
    }

    return {
        atoms: {
            data: molecule.atoms.data,
            draft: molecule.atoms.draft,
            isDirty: molecule.atoms.isDirty,
        },
        reducers: {
            update: molecule.reducers.update,
            discard: molecule.reducers.discard,
        },
        drillIn: drillInConfig,
    }
}

/**
 * Create a read-only adapter (no editing capabilities).
 *
 * Useful for viewing entity data without edit functionality.
 *
 * @example
 * ```typescript
 * const readOnlyAdapter = createReadOnlyDrillInAdapter(traceSpanMolecule)
 *
 * <MoleculeDrillInView
 *   entityId={spanId}
 *   molecule={readOnlyAdapter}
 *   editable={false}
 * />
 * ```
 */
export function createReadOnlyDrillInAdapter<TEntity, TDraft>(
    molecule: AdaptableMolecule<TEntity, TDraft>,
    options?: Omit<CreateAdapterOptions<TEntity>, "fields">,
): MoleculeDrillInAdapter<TEntity, TDraft> {
    return createMoleculeDrillInAdapter(molecule, {
        ...options,
        fields: {
            editable: false,
            collapsible: true,
            copyable: true,
            deletable: false,
            addable: false,
        },
    })
}

/**
 * Create an editable adapter with full editing capabilities.
 *
 * @example
 * ```typescript
 * const editableAdapter = createEditableDrillInAdapter(testcaseMolecule)
 *
 * <MoleculeDrillInView
 *   entityId={testcaseId}
 *   molecule={editableAdapter}
 * />
 * ```
 */
export function createEditableDrillInAdapter<TEntity, TDraft>(
    molecule: AdaptableMolecule<TEntity, TDraft>,
    options?: Omit<CreateAdapterOptions<TEntity>, "fields">,
): MoleculeDrillInAdapter<TEntity, TDraft> {
    return createMoleculeDrillInAdapter(molecule, {
        ...options,
        fields: {
            editable: true,
            collapsible: true,
            copyable: true,
            deletable: true,
            addable: true,
        },
    })
}
