import {memo, useMemo} from "react"

import {Typography} from "antd"

interface DeleteEvaluatorsModalContentProps {
    selectedCount: number
    selectedNames: string[]
}

const DeleteEvaluatorsModalContent = ({
    selectedCount,
    selectedNames,
}: DeleteEvaluatorsModalContentProps) => {
    const previewNames = useMemo(() => selectedNames.slice(0, 3), [selectedNames])
    const remaining = Math.max(selectedCount - previewNames.length, 0)

    return (
        <div className="space-y-3">
            <Typography.Paragraph className="mb-0 text-sm text-slate-700">
                {selectedCount === 1
                    ? "Are you sure you want to delete this evaluator?"
                    : "Are you sure you want to delete the selected evaluators?"}
            </Typography.Paragraph>

            {previewNames.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                    {previewNames.map((name) => (
                        <li key={name}>{name}</li>
                    ))}
                    {remaining > 0 && <li>and {remaining} more…</li>}
                </ul>
            )}
        </div>
    )
}

export default memo(DeleteEvaluatorsModalContent)
