import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {SkeletonBlock} from "@agenta/ui/ui"

import {ScreenScaffold} from "@/components/ScreenScaffold"

import {
    PAGE_BODY,
    PAGE_BODY_UNDER_TOOLBAR,
    PAGE_GUTTERS,
    PAGE_TITLE_BLOCK,
    PAGE_TITLE_ROW,
    pageColumn,
    type PageWidth,
} from "../../page-layout/pageFrame"

/** An agent page while its code loads, in `PageLayout`'s frame: title, Builder, line, toolbar, body. */
export const AgentPageSkeleton = ({
    width = "lg",
    toolbar,
    children,
}: {
    width?: PageWidth
    toolbar?: ReactNode
    children: ReactNode
}) => {
    const t = useT(commonCatalog)
    return (
        <ScreenScaffold
            header={
                <>
                    {/* The compact bar, so the title does not drop when the page arrives. */}
                    <div className="h-header shrink-0 bg-muted lg:hidden" aria-hidden />
                    <div className={`${PAGE_TITLE_BLOCK} ${PAGE_GUTTERS}`} aria-hidden>
                        <div className={pageColumn(width)}>
                            <div className={PAGE_TITLE_ROW}>
                                <SkeletonBlock active className="h-6 w-40" />
                                <span className="flex-1" />
                                <SkeletonBlock active className="h-control w-24 max-lg:hidden" />
                            </div>
                            <div className="mt-1 flex h-5 items-center">
                                <SkeletonBlock active className="h-3.5 w-80 max-w-full" />
                            </div>
                            {toolbar ? <div className="mt-6">{toolbar}</div> : null}
                        </div>
                    </div>
                </>
            }
        >
            <div className={PAGE_GUTTERS}>
                <div
                    className={`${pageColumn(width)} ${toolbar ? PAGE_BODY_UNDER_TOOLBAR : PAGE_BODY}`}
                    aria-busy="true"
                    aria-label={t("common.loading")}
                >
                    {children}
                </div>
            </div>
        </ScreenScaffold>
    )
}
