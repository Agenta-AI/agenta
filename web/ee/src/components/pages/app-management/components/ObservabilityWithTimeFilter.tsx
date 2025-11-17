import TimeFilter from "@/oss/components/TimeFilter"

import {useObservabilityDashboard} from "../../../../state/observability"
import ObservabilityDashboardSection from "./ObservabilityDashboardSection"

const ObservabilityWithTimeFilter = () => {
    const {timeRange, setTimeRange} = useObservabilityDashboard()

    return (
        <>
            <div style={{display: "flex", justifyContent: "flex-end", marginBottom: 8}}>
                <TimeFilter value={timeRange} onChange={setTimeRange} />
            </div>
            <ObservabilityDashboardSection />
        </>
    )
}

export default ObservabilityWithTimeFilter
