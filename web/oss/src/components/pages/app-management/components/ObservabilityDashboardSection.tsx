import AnalyticsDashboard from "@/oss/components/pages/observability/dashboard/AnalyticsDashboard"

const ObservabilityDashboardSection = () => {
    return (
        <div className="flex flex-col gap-4 [&_.ant-spin-nested-loading]:w-full">
            <AnalyticsDashboard layout="grid-4" />
        </div>
    )
}

export default ObservabilityDashboardSection
