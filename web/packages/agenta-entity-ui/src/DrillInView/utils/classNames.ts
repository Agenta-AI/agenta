/**
 * DrillInView ClassNames API
 *
 * Provides consistent class naming following Ant Design v6 patterns.
 * All parts have prefixed class names for easy targeting.
 */

import type {DrillInClassNames, DrillInStateClassNames} from "../types"

// ============================================================================
// PREFIX
// ============================================================================

/**
 * Base prefix for all drill-in class names
 */
export const drillInPrefixCls = "ag-drill-in"

// ============================================================================
// DEFAULT CLASS NAMES
// ============================================================================

/**
 * Default class names for all drill-in parts
 */
export const defaultClassNames: Required<DrillInClassNames> = {
    root: `${drillInPrefixCls}`,
    breadcrumb: `${drillInPrefixCls}-breadcrumb`,
    breadcrumbItem: `${drillInPrefixCls}-breadcrumb-item`,
    breadcrumbSeparator: `${drillInPrefixCls}-breadcrumb-separator`,
    breadcrumbBack: `${drillInPrefixCls}-breadcrumb-back`,
    fieldList: `${drillInPrefixCls}-field-list`,
    fieldItem: `${drillInPrefixCls}-field-item`,
    fieldHeader: `${drillInPrefixCls}-field-header`,
    fieldHeaderTitle: `${drillInPrefixCls}-field-header-title`,
    fieldHeaderMeta: `${drillInPrefixCls}-field-header-meta`,
    fieldHeaderActions: `${drillInPrefixCls}-field-header-actions`,
    fieldContent: `${drillInPrefixCls}-field-content`,
    valueRenderer: `${drillInPrefixCls}-value`,
    empty: `${drillInPrefixCls}-empty`,
}

/**
 * Default state class names
 */
export const defaultStateClassNames: Required<DrillInStateClassNames> = {
    collapsed: `${drillInPrefixCls}--collapsed`,
    expanded: `${drillInPrefixCls}--expanded`,
    editable: `${drillInPrefixCls}--editable`,
    dirty: `${drillInPrefixCls}--dirty`,
    focused: `${drillInPrefixCls}--focused`,
    dragging: `${drillInPrefixCls}--dragging`,
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Merge user class names with defaults
 *
 * @example
 * ```typescript
 * const classes = mergeClassNames({ root: 'my-custom-root' })
 * // { root: 'ag-drill-in my-custom-root', ... }
 * ```
 */
export function mergeClassNames(userClassNames?: DrillInClassNames): Required<DrillInClassNames> {
    if (!userClassNames) return defaultClassNames

    const merged = {...defaultClassNames}

    for (const key of Object.keys(userClassNames) as (keyof DrillInClassNames)[]) {
        const userClass = userClassNames[key]
        if (userClass) {
            merged[key] = `${defaultClassNames[key]} ${userClass}`
        }
    }

    return merged
}

/**
 * Build class name string with optional state modifiers
 *
 * @example
 * ```typescript
 * const className = buildClassName('fieldItem', { collapsed: true, dirty: true })
 * // 'ag-drill-in-field-item ag-drill-in--collapsed ag-drill-in--dirty'
 * ```
 */
export function buildClassName(
    part: keyof DrillInClassNames,
    states?: Partial<Record<keyof DrillInStateClassNames, boolean>>,
    userClassNames?: DrillInClassNames,
): string {
    const classes = mergeClassNames(userClassNames)
    const parts: string[] = [classes[part]]

    if (states) {
        for (const [state, active] of Object.entries(states)) {
            if (active) {
                parts.push(defaultStateClassNames[state as keyof DrillInStateClassNames])
            }
        }
    }

    return parts.join(" ")
}

/**
 * Create a class name builder bound to specific user overrides
 *
 * @example
 * ```typescript
 * const cx = createClassNameBuilder({ root: 'my-root' })
 * cx('fieldItem', { collapsed: true })
 * // 'ag-drill-in-field-item ag-drill-in--collapsed'
 * ```
 */
export function createClassNameBuilder(userClassNames?: DrillInClassNames) {
    const classes = mergeClassNames(userClassNames)

    return function cx(
        part: keyof DrillInClassNames,
        states?: Partial<Record<keyof DrillInStateClassNames, boolean>>,
    ): string {
        const parts: string[] = [classes[part]]

        if (states) {
            for (const [state, active] of Object.entries(states)) {
                if (active) {
                    parts.push(defaultStateClassNames[state as keyof DrillInStateClassNames])
                }
            }
        }

        return parts.join(" ")
    }
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to create memoized class names
 *
 * @example
 * ```tsx
 * function MyComponent({ classNames }: Props) {
 *   const cx = useDrillInClassNames(classNames)
 *   return <div className={cx('root')} />
 * }
 * ```
 */
export function useDrillInClassNames(userClassNames?: DrillInClassNames) {
    // In a real implementation, this would use useMemo
    // For now, return the builder directly (package doesn't have React dep)
    return createClassNameBuilder(userClassNames)
}
