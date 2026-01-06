import {memo, useMemo} from "react"

import {Card, Typography} from "antd"

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
        <Card variant="outlined" className="[&_.ant-card-body]:p-0">
            <div className="flex flex-col">
                <div className="border border-solid border-[#EAEFF5] rounded h-full">
                    <div className="py-2 px-3 flex flex-col justify-center border-0 border-b border-solid border-[#EAEFF5]">
                        <Typography.Text className="font-medium">
                            Evaluator Scores Overview
                        </Typography.Text>
                        <Typography.Text className="text-[#758391]">
                            Average evaluator score across evaluations
                        </Typography.Text>
                    </div>
                    <div className="flex flex-col gap-2 p-2 lg:flex-row lg:items-stretch">
                        <div className="w-full lg:w-7/12">
                            <MetadataSummaryTable runIds={orderedRunIds} projectURL={projectURL} />
                        </div>
                        <div className="grow flex items-center justify-center h-[320px] min-h-[320px] lg:h-auto lg:w-5/12">
                            <OverviewSpiderChart runIds={orderedRunIds} />
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    )
}

export default memo(AggregatedOverviewSection)
