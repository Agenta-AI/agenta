import {memo, useMemo, useState} from "react"

import {Button, Card} from "antd"

import useURL from "@/oss/hooks/useURL"

import MetadataSummaryTable from "./MetadataSummaryTable"
import OverviewSpiderChart from "./OverviewSpiderChart"

interface AggregatedOverviewSectionProps {
    runIds: string[]
}

const AggregatedOverviewSection = ({runIds}: AggregatedOverviewSectionProps) => {
    const orderedRunIds = useMemo(() => runIds.filter((id): id is string => Boolean(id)), [runIds])
    const {projectURL} = useURL()
    const [expanded, setExpanded] = useState(false)
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
                    <div className="relative flex-1 min-h-[320px]">
                        <div className="absolute right-0 top-0 z-10">
                            <Button size="small" onClick={() => setExpanded((v) => !v)}>
                                {expanded ? "Collapse" : "Expand"}
                            </Button>
                        </div>
                        <OverviewSpiderChart runIds={orderedRunIds} expand={expanded} />
                    </div>
                </div>

                {/* <OverviewMetricComparison runIds={orderedRunIds} /> */}
            </div>
        </Card>
    )
}

export default memo(AggregatedOverviewSection)
