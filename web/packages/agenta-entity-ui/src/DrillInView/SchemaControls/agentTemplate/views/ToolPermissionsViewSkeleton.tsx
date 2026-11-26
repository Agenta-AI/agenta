/** The loading shape of the integration and MCP server views: the title line over the permission body (STATE-02). */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {SkeletonBlock} from "@agenta/ui/ui"

import {ToolPermissionsSkeleton} from "../../DrawerSkeletons"

/** `nameAndHost`: the MCP server's title, with its host under the name. */
export function ToolPermissionsViewSkeleton({title}: {title: "name" | "nameAndHost"}) {
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
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-5 items-center">
                        <SkeletonBlock className="h-3.5 w-28" />
                    </div>
                    {title === "nameAndHost" ? (
                        <div className="flex h-4 items-center">
                            <SkeletonBlock className="h-3 w-36" />
                        </div>
                    ) : null}
                </div>
            </div>
            <ToolPermissionsSkeleton />
        </div>
    )
}
