import {PageLayout} from "@agenta/ui"
import {Spin, Typography} from "antd"

import {useAnalyticsDashboard} from "@/oss/state/analytics/dashboard"

import AnalyticsHeaderControls from "./components/AnalyticsHeaderControls"
import ChartsGrid from "./components/ChartsGrid"

const AnalyticsPage = () => {
    const {data, loading, isError} = useAnalyticsDashboard()

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
                    <ChartsGrid current={data?.current ?? null} failed={isError} />
                </div>
            </Spin>
        </PageLayout>
    )
}

export default AnalyticsPage
