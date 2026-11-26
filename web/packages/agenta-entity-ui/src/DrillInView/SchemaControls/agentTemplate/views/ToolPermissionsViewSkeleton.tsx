/** The loading shape of the integration and MCP server views: the one-line title over the permission body (STATE-02). */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {SkeletonBlock} from "@agenta/ui/ui"

import {ToolPermissionsSkeleton} from "../../DrawerSkeletons"

export function ToolPermissionsViewSkeleton({account}: {account?: "switch" | "line"}) {
    const t = useT(commonCatalog)
    return (
        <div
            role="status"
            aria-busy
            aria-label={t("common.loading")}
            className="flex min-h-0 flex-1 flex-col"
        >
            <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
                <SkeletonBlock shape="mark" className="size-6 shrink-0" />
                <div className="flex h-5 min-w-0 flex-1 items-center">
                    <SkeletonBlock className="h-3.5 w-28" />
                </div>
            </div>
            <ToolPermissionsSkeleton account={account} />
        </div>
    )
}
