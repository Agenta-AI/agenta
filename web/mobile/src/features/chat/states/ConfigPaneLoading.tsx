import {useT} from "@agenta/i18n"
import chatMobileConfigCatalog from "@agenta/i18n/catalogs/chat.mobileConfig"
import {CONFIG_REGION_BAR} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"

/** Title and summary widths of the panel's cards, as `AgentConfigSkeleton` draws them. */
const CARDS = [
    [44, 84],
    [84, 64],
    [88, 72],
    [76, 72],
    [88, 60],
    [40, 52],
    [68, 0],
] as const

/**
 * The config pane while its chunk loads: the real "Configuration" bar over section cards on the
 * geometry of `AgentConfigSkeleton`, which ships inside that chunk and so cannot cover this gap.
 */
export const ConfigPaneLoading = () => {
    const t = useT(chatMobileConfigCatalog)
    return (
        <div
            className="ag-panel-raised flex h-full min-h-0 w-full flex-col"
            role="status"
            aria-busy
            aria-label={t("chat.mobileConfig.loadingConfiguration")}
        >
            <div className={CONFIG_REGION_BAR}>
                <span className="text-label font-semibold text-foreground">
                    {t("chat.mobileConfig.configuration")}
                </span>
                <SkeletonBlock active className="h-7 w-7" />
            </div>
            <div className="flex flex-col gap-2 px-4 pb-3 pt-3">
                {CARDS.map(([title, value], i) => (
                    <div
                        key={i}
                        className="-mx-2.5 flex h-10 items-center gap-2 rounded-lg bg-muted px-2.5"
                    >
                        <span className="size-7 shrink-0 rounded-md bg-background" />
                        <SkeletonBlock active style={{width: title, height: 14}} />
                        {value ? (
                            <SkeletonBlock
                                active
                                className="ml-auto"
                                style={{width: value, height: 12}}
                            />
                        ) : (
                            <span className="ml-auto" />
                        )}
                        <SkeletonBlock active className="size-3.5" />
                    </div>
                ))}
            </div>
        </div>
    )
}
