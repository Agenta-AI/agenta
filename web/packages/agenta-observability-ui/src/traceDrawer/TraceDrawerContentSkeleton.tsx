import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawerLoading"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import type {DynamicOptionsLoadingProps} from "next/dynamic"

/**
 * The drawer body while its code loads on the first open. It keeps the header row of
 * `TraceDrawerContent`, so the content replaces it without a shift. If the code fails to load,
 * it offers a retry instead of loading forever.
 */
const TraceDrawerContentSkeleton = ({error, retry}: DynamicOptionsLoadingProps) => {
    const t = useT(drawerCatalog)
    return error ? (
        <LoadError title={t("observabilityUi.traceDrawerLoading.loadFailed")} onRetry={retry} />
    ) : (
        <div
            className="h-full w-full flex flex-col"
            role="status"
            aria-label={t("observabilityUi.traceDrawerLoading.loadingTrace")}
        >
            <div className="flex items-center gap-3 px-4 py-3 border-0 border-b border-solid border-border-muted">
                <SkeletonBlock className="h-6 max-w-[240px]" />
            </div>
            <div className="flex flex-col gap-3 p-4">
                <SkeletonBlock className="max-w-[320px]" />
                <SkeletonBlock className="h-24" />
                <SkeletonBlock className="h-24" />
            </div>
        </div>
    )
}

export default TraceDrawerContentSkeleton
