import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {LoadError} from "@agenta/ui/components/presentational"
import type {DynamicOptionsLoadingProps} from "next/dynamic"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

/**
 * The drawer body while its code loads on the first open. It keeps the header row of
 * `TraceDrawerContent`, so the content replaces it without a shift. If the code fails to load,
 * it offers a retry instead of loading forever.
 */
const TraceDrawerContentSkeleton = ({error, retry}: DynamicOptionsLoadingProps) => {
    const t = useT(drawerCatalog)
    return error ? (
        <LoadError title={t("observabilityUi.traceDrawer.loadFailed")} onRetry={retry} />
    ) : (
        <div
            className="h-full w-full flex flex-col"
            role="status"
            aria-label={t("observabilityUi.traceDrawer.loadingTrace")}
        >
            <div className="flex items-center gap-3 px-4 py-3 border-0 border-b border-solid border-colorSplit">
                <SkeletonBlock className="h-6 max-w-[240px]" />
            </div>
            <div className="flex flex-col gap-3 p-4">
                <SkeletonBlock className="max-w-[320px]" />
                <SkeletonBlock className="h-24 max-w-none" />
                <SkeletonBlock className="h-24 max-w-none" />
            </div>
        </div>
    )
}

export default TraceDrawerContentSkeleton
