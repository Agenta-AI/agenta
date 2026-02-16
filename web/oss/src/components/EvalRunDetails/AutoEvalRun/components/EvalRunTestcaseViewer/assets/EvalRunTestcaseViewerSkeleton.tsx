import {memo} from "react"

import {Skeleton} from "antd"

export const EvalRunTestcaseTableSkeleton = memo(
    ({rows = 8, cols = 5, rowHight = 60}: {rows?: number; cols?: number; rowHight?: number}) => {
        return (
            <div className="overflow-hidden border border-solid border-[#0517290F] !rounded-lg">
                <table className="w-full border-collapse">
                    <thead>
                        <tr>
                            {Array.from({length: cols}).map((_, colIndex) => (
                                <th
                                    key={colIndex}
                                    className="border border-solid border-[#0517290F] px-3 py-2 text-left bg-gray-50"
                                >
                                    <Skeleton.Input
                                        active
                                        style={{width: (80 * colIndex) / 1.5, height: 20}}
                                        size="small"
                                    />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({length: rows}).map((_, rowIndex) => (
                            <tr key={rowIndex}>
                                {Array.from({length: cols}).map((_, colIndex) => (
                                    <td
                                        key={colIndex}
                                        className="border border-solid border-[#0517290F] px-3 py-2"
                                    >
                                        <Skeleton.Input
                                            active
                                            style={{
                                                width: (200 * colIndex) / 2,
                                                height: rowHight,
                                            }}
                                            size="small"
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )
    },
)

const EvalRunTestcaseViewerSkeleton = ({
    rows = 8,
    cols = 5,
    rowHight = 60,
}: {
    rows?: number
    cols?: number
    rowHight?: number
}) => {
    return (
        <div className="flex flex-col grow gap-2 pb-4 min-h-0 px-6">
            <div className="flex items-center justify-between">
                <Skeleton.Input active className="!w-[200px] !h-[28px]" />
                <div className="flex items-center gap-2">
                    <Skeleton.Input active className="!h-[28px]" />
                    <Skeleton.Input active className="!h-[28px]" />
                </div>
            </div>

            <EvalRunTestcaseTableSkeleton rows={rows} cols={cols} rowHight={rowHight} />
        </div>
    )
}

export default memo(EvalRunTestcaseViewerSkeleton)
