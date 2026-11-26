import {Input, SimpleTooltip, Switch} from "@agenta/ui/ui"

/**
 * "Run on historical data", shown off and disabled with its start and end dates, as in the old
 * app: the API does not run a live evaluation over past traces yet.
 */
export const HistoricalDataControl = () => (
    <div className="flex flex-wrap items-center justify-between gap-3">
        <SimpleTooltip title="Not available yet">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch aria-label="Run on historical data" checked={false} disabled />
                Run on historical data
            </span>
        </SimpleTooltip>
        <span className="flex items-center gap-1.5">
            <Input
                aria-label="Start date"
                placeholder="Start date"
                disabled
                className="h-8 w-[110px]"
            />
            <span aria-hidden className="text-muted-foreground">
                →
            </span>
            <Input
                aria-label="End date"
                placeholder="End date"
                disabled
                className="h-8 w-[110px]"
            />
        </span>
    </div>
)
