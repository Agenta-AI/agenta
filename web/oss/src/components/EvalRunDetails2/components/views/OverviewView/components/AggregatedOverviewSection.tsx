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
        <Card variant="outlined">
            <div className="flex flex-col">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
                    <div className="w-7/12">
                        <MetadataSummaryTable runIds={orderedRunIds} projectURL={projectURL} />
                    </div>
                    <div className="grow flex items-center justify-center min-h-[320px] w-5/12">
                        <OverviewSpiderChart runIds={orderedRunIds} />
                    </div>
                </div>
            </div>
        </Card>
    )
}

export default memo(AggregatedOverviewSection)
