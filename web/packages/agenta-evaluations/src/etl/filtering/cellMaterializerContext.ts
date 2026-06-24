/**
 * One-line context shared between the table page (provider) and the cells
 * (consumers). Cells call `materializer.request(slice, req)` when their
 * column's data is missing from cache; the materializer coalesces
 * concurrent same-tick requests into one bulk fetch per slice.
 *
 * Kept in its own file to avoid a circular import between
 * `EtlResolvedCell` and the table (the cell imports the context type,
 * the page sets the context value).
 */

import {createContext} from "react"

import type {CellMaterializer} from "./useCellMaterialization"

export const CellMaterializerContext = createContext<CellMaterializer | null>(null)
