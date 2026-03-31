/**
 * MoleculeDrillInView Component
 *
 * Molecule-first drill-in navigation component.
 * Uses types from @agenta/entity-ui for configuration.
 *
 * @example
 * ```tsx
 * import { MoleculeDrillInView } from "@agenta/entity-ui"
 * import { traceSpanMolecule } from "@agenta/entities/trace"
 *
 * <MoleculeDrillInView
 *   molecule={traceSpanAdapter}
 *   entityId={spanId}
 *   classNames={{ root: 'my-drill-in' }}
 *   slots={{
 *     fieldHeader: (props) => <CustomHeader {...props} />
 *   }}
 * />
 * ```
 */

import type {MoleculeDrillInViewProps} from "../types"

import {MoleculeDrillInBreadcrumb} from "./MoleculeDrillInBreadcrumb"
import {MoleculeDrillInProvider, useDrillIn} from "./MoleculeDrillInContext"
import {MoleculeDrillInFieldList} from "./MoleculeDrillInFieldList"

// ============================================================================
// INTERNAL VIEW COMPONENT
// ============================================================================

/**
 * Internal view component that renders inside the provider
 * Has access to context via useDrillIn hook
 */
function MoleculeDrillInViewInternal() {
    const {classNames, styles, showBreadcrumb} = useDrillIn()

    return (
        <div className={classNames.root} style={styles?.root}>
            {/* Breadcrumb navigation */}
            {showBreadcrumb && <MoleculeDrillInBreadcrumb />}

            {/* Field list */}
            <MoleculeDrillInFieldList />
        </div>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * MoleculeDrillInView
 *
 * Molecule-first drill-in view component with:
 * - ClassNames API for styling customization
 * - Slots API for custom rendering
 * - Molecule-level configuration
 *
 * The component wraps content in MoleculeDrillInProvider
 * which provides all shared state via context.
 */
export function MoleculeDrillInView<TEntity = unknown, TDraft = Partial<TEntity>>({
    entityId,
    molecule,
    initialPath,
    currentPath,
    onPathChange,
    editable,
    collapsible,
    classNames,
    styles,
    slots,
    rootTitle,
    showBreadcrumb,
    showBackArrow,
    // Event handlers - will be used in future enhancements
    onValueChange: _onValueChange,
    onFieldClick: _onFieldClick,
    onFieldModifierClick: _onFieldModifierClick,
}: MoleculeDrillInViewProps<TEntity, TDraft>) {
    return (
        <MoleculeDrillInProvider
            entityId={entityId}
            molecule={molecule}
            initialPath={initialPath}
            currentPath={currentPath}
            onPathChange={onPathChange}
            editable={editable}
            collapsible={collapsible}
            classNames={classNames}
            styles={styles}
            slots={slots}
            rootTitle={rootTitle}
            showBreadcrumb={showBreadcrumb}
            showBackArrow={showBackArrow}
        >
            <MoleculeDrillInViewInternal />
        </MoleculeDrillInProvider>
    )
}
