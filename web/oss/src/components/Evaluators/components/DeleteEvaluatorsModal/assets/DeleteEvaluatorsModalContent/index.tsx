import {memo, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {EntityNameWithVersion} from "@agenta/ui"
import {Typography} from "antd"

interface DeleteEvaluatorsModalContentProps {
    selectedCount: number
    revisionIds: string[]
}

interface ResolvedEntity {
    id: string
    name: string
    version: number | null
}

const DeleteEvaluatorsModalContent = ({
    selectedCount,
    revisionIds,
}: DeleteEvaluatorsModalContentProps) => {
    const resolvedEntities = useMemo(
        () =>
            revisionIds
                .map((id): ResolvedEntity | null => {
                    const data = workflowMolecule.get.data(id)
                    if (!data) return null
                    return {
                        id,
                        name: (data.name as string) || (data.slug as string) || id,
                        version: (data.version as number) ?? null,
                    }
                })
                .filter(Boolean) as ResolvedEntity[],
        [revisionIds],
    )

    const previewEntities = useMemo(() => resolvedEntities.slice(0, 3), [resolvedEntities])
    const remaining = Math.max(selectedCount - previewEntities.length, 0)

    return (
        <div className="space-y-3">
            <Typography.Paragraph className="mb-0 text-sm text-slate-700">
                {selectedCount === 1 && previewEntities[0] ? (
                    <>
                        Are you sure you want to archive{" "}
                        <EntityNameWithVersion
                            name={previewEntities[0].name}
                            version={previewEntities[0].version}
                        />
                        ?
                    </>
                ) : selectedCount === 1 ? (
                    "Are you sure you want to archive this evaluator?"
                ) : (
                    "Are you sure you want to archive the selected evaluators?"
                )}
            </Typography.Paragraph>

            {selectedCount > 1 && previewEntities.length > 0 && (
                <div className="flex flex-col gap-2">
                    {previewEntities.map((entity) => (
                        <div
                            key={entity.id}
                            className="flex items-center rounded-md bg-gray-50 px-3 py-2"
                        >
                            <EntityNameWithVersion
                                name={entity.name}
                                version={entity.version}
                                size="default"
                            />
                        </div>
                    ))}
                    {remaining > 0 && (
                        <Typography.Text type="secondary" className="text-xs pl-3">
                            and {remaining} more…
                        </Typography.Text>
                    )}
                </div>
            )}

            <Typography.Text type="secondary" className="text-xs">
                Archived evaluators are hidden from your workspace and can be restored later.
            </Typography.Text>
        </div>
    )
}

export default memo(DeleteEvaluatorsModalContent)
