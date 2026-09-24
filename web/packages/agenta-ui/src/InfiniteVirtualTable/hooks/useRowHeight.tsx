import {useMemo} from "react"

import {Rows} from "@phosphor-icons/react"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {TableMenuItem} from "../tableMenu"

/**
 * Row height size options
 */
export type RowHeightSize = "small" | "medium" | "large"

/**
 * Configuration for a single row height option
 */
export interface RowHeightOption {
    /** Pixel height for this size */
    height: number
    /** Display label in the menu */
    label: string
    /** Optional: max lines to show in cells (for text truncation) */
    maxLines?: number
}

/**
 * Full row height configuration for a table
 */
export interface RowHeightConfig {
    /** Configuration for each size option */
    sizes: Record<RowHeightSize, RowHeightOption>
    /** Default size to use */
    defaultSize: RowHeightSize
    /** LocalStorage key for persisting the preference */
    storageKey: string
}

/**
 * Default row height configuration
 * Can be used as-is or customized per table
 */
export const DEFAULT_ROW_HEIGHT_CONFIG: Omit<RowHeightConfig, "storageKey"> = {
    sizes: {
        small: {height: 80, label: "Small", maxLines: 4},
        medium: {height: 160, label: "Medium", maxLines: 10},
        large: {height: 280, label: "Large", maxLines: 18},
    },
    defaultSize: "medium",
}

/**
 * Creates a persisted atom for row height preference
 * @param storageKey - LocalStorage key for persistence
 * @param defaultSize - Default row height size
 */
export function createRowHeightAtom(storageKey: string, defaultSize: RowHeightSize = "medium") {
    return atomWithStorage<RowHeightSize>(storageKey, defaultSize)
}

/**
 * Return type for useRowHeight hook
 */
export interface UseRowHeightResult {
    /** Current row height size (small/medium/large) */
    size: RowHeightSize
    /** Set the row height size */
    setSize: (size: RowHeightSize) => void
    /** Current row height in pixels */
    heightPx: number
    /** Max lines to show in cells */
    maxLines: number
    /** Menu items for the settings dropdown */
    menuItems: TableMenuItem[]
}

/**
 * Hook to manage row height state and provide menu items for the settings dropdown
 *
 * @param sizeAtom - Persisted atom for row height size
 * @param config - Row height configuration
 * @returns Row height state and menu items
 *
 * @example
 * ```tsx
 * // In your table component's state file:
 * export const myTableRowHeightAtom = createRowHeightAtom("agenta:my-table:row-height")
 *
 * // In your table component:
 * const rowHeight = useRowHeight(myTableRowHeightAtom, {
 *   sizes: DEFAULT_ROW_HEIGHT_CONFIG.sizes,
 *   defaultSize: "medium",
 *   storageKey: "agenta:my-table:row-height"
 * })
 *
 * <InfiniteVirtualTableFeatureShell
 *   rowHeight={rowHeight.heightPx}
 *   settingsDropdownMenuItems={rowHeight.menuItems}
 *   useSettingsDropdown
 * />
 * ```
 */
export function useRowHeight(
    sizeAtom: ReturnType<typeof createRowHeightAtom>,
    config: RowHeightConfig,
): UseRowHeightResult {
    const [size, setSize] = useAtom(sizeAtom)

    const heightPx = useMemo(() => config.sizes[size].height, [config.sizes, size])
    const maxLines = useMemo(() => config.sizes[size].maxLines ?? 10, [config.sizes, size])

    const menuItems = useMemo<TableMenuItem[]>(() => {
        const sizes: RowHeightSize[] = ["small", "medium", "large"]
        return [
            {
                key: "row-height",
                label: "Row height",
                icon: <Rows size={16} />,
                children: sizes.map((s) => ({
                    key: `row-height-${s}`,
                    // The selected size reads as bold, the way antd's inline style did.
                    label: (
                        <span className={size === s ? "font-semibold" : undefined}>
                            {config.sizes[s].label}
                        </span>
                    ),
                    onClick: () => setSize(s),
                })),
            },
        ]
    }, [config.sizes, size, setSize])

    return {
        size,
        setSize,
        heightPx,
        maxLines,
        menuItems,
    }
}
