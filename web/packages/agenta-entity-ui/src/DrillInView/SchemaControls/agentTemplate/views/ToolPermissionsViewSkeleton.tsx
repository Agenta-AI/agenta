/** The loading shape of the integration and MCP server views: the one-line title over the permission body (STATE-02). */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ItemViewTitleSkeleton} from "@agenta/ui/composed"

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
            <ItemViewTitleSkeleton description={false} className="shrink-0 px-4 pt-4" />
            <ToolPermissionsSkeleton account={account} />
        </div>
    )
}
