import TimeFilter from "@/oss/components/TimeFilter"

import {useObservabilityDashboard} from "../../../../state/observability"
import ObservabilityOverview from "./ObservabilityOverview"

const ObservabilityWithTimeFilter = () => {
    const {timeRange, setTimeRange} = useObservabilityDashboard()

    return (
        <>
            <div style={{display: "flex", justifyContent: "flex-end", marginBottom: 8}}>
                <TimeFilter value={timeRange} onChange={setTimeRange} />
            </div>
            <ObservabilityOverview />
        </>
    )
}

export default ObservabilityWithTimeFilter
