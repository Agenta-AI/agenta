import {useMemo} from "react"

import type {MenuProps} from "antd"
import {atomWithStorage} from "jotai/utils"

import type {RowHeightContextValue} from "../context/RowHeightContext"

import {
    DEFAULT_ROW_HEIGHT_CONFIG,
    useRowHeight,
    type RowHeightConfig,
    type RowHeightSize,
} from "./useRowHeight"

/**
 * Configuration for the built-in row height feature
 */
export interface RowHeightFeatureConfig {
    /** LocalStorage key for persisting preference */
    storageKey: string
    /** Default size (default: "medium") */
    defaultSize?: RowHeightSize
    /** Custom size configurations (optional, uses DEFAULT_ROW_HEIGHT_CONFIG if not provided) */
    sizes?: RowHeightConfig["sizes"]
}

/**
 * Result from useRowHeightFeature hook
 */
export interface UseRowHeightFeatureResult {
    /** Context value to provide to RowHeightContext.Provider */
    contextValue: RowHeightContextValue
    /** Menu items for the settings dropdown */
    menuItems: MenuProps["items"]
    /** Row height in pixels (for IVT rowHeight prop) */
    heightPx: number
}

/**
 * Cache of atoms by storage key to avoid recreating atoms on every render.
 * This ensures the same atom instance is used for the same storage key.
 */
const atomCache = new Map<string, ReturnType<typeof atomWithStorage<RowHeightSize>>>()

function getOrCreateAtom(
    storageKey: string,
    defaultSize: RowHeightSize,
): ReturnType<typeof atomWithStorage<RowHeightSize>> {
    const existing = atomCache.get(storageKey)
    if (existing) return existing

    const newAtom = atomWithStorage<RowHeightSize>(storageKey, defaultSize)
    atomCache.set(storageKey, newAtom)
    return newAtom
}

/**
 * Hook for built-in row height feature in InfiniteVirtualTableFeatureShell.
 * Manages the persisted atom internally and provides everything needed for the feature.
 * Composes the lower-level useRowHeight hook to avoid logic duplication.
 *
 * @param config - Row height feature configuration
 * @returns Context value, menu items, and height for IVT
 */
export function useRowHeightFeature(config: RowHeightFeatureConfig): UseRowHeightFeatureResult {
    const {storageKey, defaultSize = "medium", sizes = DEFAULT_ROW_HEIGHT_CONFIG.sizes} = config

    // Get or create the persisted atom for this storage key
    const sizeAtom = useMemo(
        () => getOrCreateAtom(storageKey, defaultSize),
        [storageKey, defaultSize],
    )

    // Compose the existing useRowHeight hook to avoid duplicating logic
    const rowHeight = useRowHeight(sizeAtom, {
        sizes,
        defaultSize,
        storageKey,
    })

    // Build context value from useRowHeight result
    const contextValue = useMemo<RowHeightContextValue>(
        () => ({
            size: rowHeight.size,
            heightPx: rowHeight.heightPx,
            maxLines: rowHeight.maxLines,
        }),
        [rowHeight.size, rowHeight.heightPx, rowHeight.maxLines],
    )

    return {
        contextValue,
        menuItems: rowHeight.menuItems,
        heightPx: rowHeight.heightPx,
    }
}
