import {memo, useMemo} from "react"

import {Card} from "antd"

import useURL from "@/oss/hooks/useURL"

import MetadataSummaryTable from "./MetadataSummaryTable"
import OverviewSpiderChart from "./OverviewSpiderChart"

interface AggregatedOverviewSectionProps {
    runIds: string[]
}

const AggregatedOverviewSection = ({runIds}: AggregatedOverviewSectionProps) => {
    const orderedRunIds = useMemo(() => runIds.filter((id): id is string => Boolean(id)), [runIds])
    const {projectURL} = useURL()
    if (!orderedRunIds.length) {
        return null
    }

    return (
        <Card bordered>
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-6 lg:flex-row">
                    <div className="flex-1 lg:max-w-[50%]">
                        <MetadataSummaryTable runIds={orderedRunIds} projectURL={projectURL} />
                    </div>
                    <div className="flex-1 min-h-[320px]">
                        <OverviewSpiderChart runIds={orderedRunIds} />
                    </div>
                </div>

                {/* <OverviewMetricComparison runIds={orderedRunIds} /> */}
            </div>
        </Card>
    )
}

export default memo(AggregatedOverviewSection)
