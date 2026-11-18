import {useT} from "@agenta/i18n"
import screenCatalog from "@agenta/i18n/catalogs/observability.screen"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {Activity} from "lucide-react"

/**
 * Designed states for the observability lists.
 *
 * The skeleton mirrors a real row's geometry (glyph, two text lines, a metrics line) so the
 * list does not shift when data lands.
 */

export const ObservabilityListSkeleton = ({rows = 6}: {rows?: number}) => (
    <div className="flex flex-col divide-y divide-border" aria-hidden>
        {Array.from({length: rows}, (_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
                <SkeletonBlock className="h-5 w-5 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <SkeletonBlock className="h-3.5 w-1/2" />
                    <SkeletonBlock className="h-3 w-3/4" />
                    <SkeletonBlock className="h-3 w-1/3" />
                </div>
            </div>
        ))}
    </div>
)

export const ObservabilityEmpty = ({title, hint}: {title?: string; hint?: string}) => {
    const t = useT(screenCatalog)
    return (
        <Empty className="py-16">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Activity />
                </EmptyMedia>
                <EmptyTitle>{title ?? t("observability.screen.noTracesTitle")}</EmptyTitle>
                <EmptyDescription>
                    {hint ?? t("observability.screen.noTracesHint")}
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}

export const ObservabilityFiltered = ({onClear}: {onClear: () => void}) => {
    const t = useT(screenCatalog)
    return (
        <Empty className="py-16">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Activity />
                </EmptyMedia>
                <EmptyTitle>{t("observability.screen.nothingMatchesTitle")}</EmptyTitle>
                <EmptyDescription>{t("observability.screen.nothingMatchesHint")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button variant="outline" size="sm" onClick={onClear}>
                    {t("observability.screen.clearFilters")}
                </Button>
            </EmptyContent>
        </Empty>
    )
}
