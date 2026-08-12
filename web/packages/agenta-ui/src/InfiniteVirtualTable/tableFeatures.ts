import {
    columnResizingFeature,
    columnSizingFeature,
    columnVisibilityFeature,
    rowSelectionFeature,
} from "@tanstack/react-table"

/**
 * The TanStack features this table registers.
 *
 * v9 ships features as opt-in modules rather than one bundled set, so what we list here is
 * what ends up in the bundle. That is the point of being on v9 at all: `/m` replaces
 * web/oss and web/ee, and every unused feature we don't register is weight it never carries.
 *
 * Add a feature here in the same change that wires the option needing it, never ahead of it.
 */
export const TABLE_FEATURES = {
    columnResizingFeature,
    columnSizingFeature,
    columnVisibilityFeature,
    rowSelectionFeature,
} as const

export type VirtualTableFeatures = typeof TABLE_FEATURES
