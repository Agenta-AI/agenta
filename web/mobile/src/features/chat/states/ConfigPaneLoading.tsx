import {CONFIG_REGION_BAR} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"

/** Title and summary widths of the Model, Instructions, Tools, MCP, Skills and Advanced rows. */
const ROWS = [
    [128, 130],
    [112, 48],
    [60, 56],
    [122, 44],
    [56, 44],
    [100, 110],
] as const

/**
 * The config pane while its chunk loads: the real "Configuration" bar over section rows on the
 * geometry of `AgentConfigSkeleton`, which ships inside that chunk and so cannot cover this gap.
 */
export const ConfigPaneLoading = () => (
    <div
        className="ag-panel-raised flex h-full min-h-0 w-full flex-col"
        role="status"
        aria-busy
        aria-label="Loading agent configuration"
    >
        <div className={CONFIG_REGION_BAR}>
            <span className="text-[13px] font-semibold text-foreground">Configuration</span>
            <SkeletonBlock active className="h-7 w-7" />
        </div>
        <div className="flex flex-col px-4 pb-3 pt-1">
            {ROWS.map(([title, value], i) => (
                <div
                    key={i}
                    className={
                        "flex min-h-[44px] items-center gap-2 py-3" +
                        (i < ROWS.length - 1 ? " border-0 border-b border-solid border-border" : "")
                    }
                >
                    <SkeletonBlock active shape="square" className="h-4 w-4" />
                    <SkeletonBlock active style={{width: title, height: 16}} />
                    <SkeletonBlock active className="ml-auto" style={{width: value, height: 14}} />
                    <SkeletonBlock active shape="circle" className="h-3.5 w-3.5" />
                </div>
            ))}
        </div>
    </div>
)
