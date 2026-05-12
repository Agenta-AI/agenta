import {useMemo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared"
import {workflowLatestRevisionIdAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {VariantDetailsWithStatus, type VariantStatusInfo} from "@agenta/entity-ui/variant"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"

interface DrawerDetailsProps {
    revisionId?: string
}

const DrawerDetails = ({revisionId}: DrawerDetailsProps) => {
    const {goToPlayground} = usePlaygroundNavigation()

    // Use workflowMolecule directly for entity data
    const workflowEntity = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(revisionId ?? ""), [revisionId]),
    )

    const parentWorkflowId = workflowEntity?.workflow_id ?? ""
    const latestRevisionId = useAtomValue(
        useMemo(() => workflowLatestRevisionIdAtomFamily(parentWorkflowId), [parentWorkflowId]),
    )
    const isLatest = !!latestRevisionId && revisionId === latestRevisionId

    if (!revisionId || !workflowEntity) return null

    const variantMin: VariantStatusInfo = {
        id: revisionId,
        deployedIn: [],
        isLatestRevision: isLatest,
    }

    const createdAt = workflowEntity.created_at
    const createdById = workflowEntity.created_by_id
    const commitMessage = workflowEntity.message

    return (
        <div className="w-[280px] overflow-auto flex flex-col gap-4 p-4">
            <Typography.Text className="text-base font-medium leading-6">Details</Typography.Text>

            <div className="flex flex-col">
                <Typography.Text className="text-sm font-medium leading-5">Variant</Typography.Text>

                <Space className="w-full items-center justify-between">
                    <VariantDetailsWithStatus
                        variantName={workflowEntity.name || workflowEntity.slug || ""}
                        revision={workflowEntity.version}
                        variant={variantMin}
                        showStable
                        isLatest={isLatest}
                    />

                    <Button
                        type="default"
                        onClick={() => goToPlayground(revisionId)}
                        icon={<ArrowSquareOut size={16} />}
                    />
                </Space>
            </div>

            {createdAt && (
                <div className="flex flex-col">
                    <Typography.Text className="text-sm font-medium leading-5">
                        Date modified
                    </Typography.Text>
                    <Tag bordered={false} className="w-fit bg-[#0517290f]">
                        {new Date(createdAt).toLocaleDateString()}
                    </Tag>
                </div>
            )}

            {createdById && (
                <div className="flex flex-col">
                    <Typography.Text className="text-sm font-medium leading-5">
                        Modified by
                    </Typography.Text>
                    <Tag bordered={false} className="w-fit bg-[#0517290f]">
                        <UserAuthorLabel userId={createdById} showPrefix={false} showAvatar />
                    </Tag>
                </div>
            )}

            {commitMessage && (
                <div className="flex flex-col">
                    <Typography.Text className="text-sm font-medium leading-5">
                        Notes
                    </Typography.Text>
                    <Tag bordered={false} className="w-fit bg-[#0517290f]">
                        {commitMessage}
                    </Tag>
                </div>
            )}
        </div>
    )
}

export default DrawerDetails
