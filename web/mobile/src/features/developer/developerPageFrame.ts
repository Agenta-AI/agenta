import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue} from "jotai"

/**
 * The page column of a developer view. Beta developer mode gives it the full width, like the old
 * app: tables show more columns on a big screen. Without it the shared 1120px cap stays, so a
 * user without developer mode sees the pages as before.
 */
const DEVELOPER_PAGE_FRAME = "box-border w-full lg:px-16"
const CAPPED_PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

export const useDeveloperPageFrame = (): string =>
    useAtomValue(betaDeveloperModeActiveAtom) ? DEVELOPER_PAGE_FRAME : CAPPED_PAGE_FRAME

/**
 * The top padding of a detail page header (test set, evaluation results). Beta developer mode
 * uses the compact header of the old app, which leaves the data about 40px more room.
 */
export const useDetailHeaderTop = (): string =>
    useAtomValue(betaDeveloperModeActiveAtom) ? "lg:pt-3" : "lg:pt-14"
