import {developerModeActiveAtom} from "@agenta/shared/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue} from "jotai"

/**
 * The page column of a developer view. Developer Mode gives it the full width:
 * tables show more columns on a big screen. Without it the shared 1120px cap stays, so a
 * user without developer mode sees the pages as before.
 */
const DEVELOPER_PAGE_FRAME = "box-border w-full lg:px-16"
const CAPPED_PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

export const useDeveloperPageFrame = (): string =>
    useAtomValue(developerModeActiveAtom) ? DEVELOPER_PAGE_FRAME : CAPPED_PAGE_FRAME

/**
 * The top padding of a detail page header (test set, evaluation results). Developer Mode
 * uses the compact header, which leaves the data about 40px more room.
 */
export const useDetailHeaderTop = (): string =>
    useAtomValue(developerModeActiveAtom) ? "lg:pt-3" : "lg:pt-14"
