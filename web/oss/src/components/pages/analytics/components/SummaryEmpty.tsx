import {Card} from "antd"

import EmptyOverlay from "./EmptyOverlay"

// Ghosted mirror of SummaryPanel shown when the window has no runs: empty health
// ring + skeleton text on the left, ghosted stat tiles under the message on the right.
const SummaryEmpty = () => (
    <Card className="[&_.ant-card-body]:p-4">
        <div className="relative">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:gap-6">
                <div className="flex items-center gap-4 xl:w-[300px] xl:shrink-0">
                    <div className="h-[92px] w-[92px] shrink-0 rounded-full border-[10px] border-solid border-colorFillSecondary" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="h-3 w-28 rounded bg-colorFillSecondary" />
                        <div className="h-2.5 w-full rounded bg-colorFillTertiary" />
                        <div className="h-2.5 w-2/3 rounded bg-colorFillTertiary" />
                    </div>
                </div>

                <div className="h-px w-full bg-colorBorderSecondary xl:h-auto xl:w-px xl:self-stretch" />

                <div className="flex-1">
                    <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-4">
                        {[0, 1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className="flex flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 opacity-60"
                            >
                                <div className="h-2.5 w-16 rounded bg-colorFillTertiary" />
                                <div className="h-5 w-20 rounded bg-colorFillSecondary" />
                                <div className="h-2.5 w-24 rounded bg-colorFillTertiary" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <EmptyOverlay subtitle="No runs match the current range and filters." />
        </div>
    </Card>
)

export default SummaryEmpty
