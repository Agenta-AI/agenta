import {PageLayout} from "@agenta/ui"
import {Spin, Typography} from "antd"

import {useAnalyticsDashboard} from "@/oss/state/analytics/dashboard"

import AnalyticsHeaderControls from "./components/AnalyticsHeaderControls"
import ChartsGrid from "./components/ChartsGrid"
import SummaryEmpty from "./components/SummaryEmpty"
import SummaryPanel from "./components/SummaryPanel"

const AnalyticsPage = () => {
    const {data, loading} = useAnalyticsDashboard()

    return (
        <PageLayout
            title="Analytics"
            className="h-full overflow-auto"
            headerTabs={<AnalyticsHeaderControls disabled={loading} />}
        >
            <Typography.Text className="text-colorTextSecondary text-[13px] -mt-2">
                How your project&apos;s agents are performing: runs, latency, cost, and tokens.
            </Typography.Text>

            <Spin spinning={loading}>
                <div className="flex flex-col gap-4 min-h-[400px]">
                    {data ? (
                        <>
                            {data.current.totals.totalRuns === 0 ? (
                                <SummaryEmpty />
                            ) : (
                                <SummaryPanel current={data.current} previous={data.previous} />
                            )}
                            <ChartsGrid current={data.current} />
                        </>
                    ) : null}
                </div>
            </Spin>
        </PageLayout>
    )
}

export default AnalyticsPage
