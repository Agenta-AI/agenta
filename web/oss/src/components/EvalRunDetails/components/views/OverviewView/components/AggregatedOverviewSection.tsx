import {memo, useMemo} from "react"

import {Card, CardContent} from "@agenta/primitive-ui/components/card"

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
        <Card className="py-0">
            <CardContent className="p-0">
                <div className="flex flex-col">
                    <div className="border border-solid border-[var(--ag-c-EAEFF5)] rounded h-full">
                        <div className="py-2 px-3 flex flex-col justify-center border-0 border-b border-solid border-[var(--ag-c-EAEFF5)]">
                            <span className="font-medium">Evaluator Scores Overview</span>
                            <span className="text-[var(--ag-c-758391)]">
                                Average evaluator score across evaluations
                            </span>
                        </div>
                        <div className="flex flex-col gap-2 p-2 lg:flex-row lg:items-stretch">
                            <div className="w-full lg:w-7/12">
                                <MetadataSummaryTable
                                    runIds={orderedRunIds}
                                    projectURL={projectURL}
                                />
                            </div>
                            <div className="grow flex items-center justify-center h-[480px] min-h-[480px] lg:h-auto lg:w-5/12">
                                <OverviewSpiderChart runIds={orderedRunIds} />
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export default memo(AggregatedOverviewSection)
