import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {useUserDisplayName} from "@agenta/entities/shared/user"
import type {Workflow} from "@agenta/entities/workflow"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Badge, Button, Flex, Popover, Tag, Typography} from "antd"

import {statusMap} from "@/oss/components/VariantDetailsWithStatus/components/EnvironmentStatus"
import VariantNameCell from "@/oss/components/VariantNameCell"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {formatVariantIdWithHash} from "@/oss/lib/helpers/utils"

type VariantPopoverProps = {
    env: AppEnvironmentDeployment
    selectedDeployedVariant: Workflow | undefined
} & React.ComponentProps<typeof Popover>

const ModifiedByText = ({variant}: {variant: Workflow}) => {
    const authorId = variant.updated_by_id ?? variant.created_by_id ?? null
    const resolvedName = useUserDisplayName(authorId ?? undefined)
    if (!resolvedName || resolvedName === "-") return null
    return <Typography.Text className="font-normal">{resolvedName}</Typography.Text>
}

const VariantPopover = ({env, selectedDeployedVariant, ...props}: VariantPopoverProps) => {
    const {goToPlayground} = usePlaygroundNavigation()

    return (
        <Popover
            {...props}
            placement="bottom"
            trigger={"hover"}
            styles={{
                root: {
                    minWidth: 256,
                    maxWidth: 360,
                },
            }}
            arrow={false}
            title={
                <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4">
                    <Flex justify="space-between">
                        <VariantNameCell revisionId={selectedDeployedVariant?.id} showBadges />

                        <Button
                            size="small"
                            icon={<ArrowSquareOut size={14} />}
                            className="flex items-center justify-center"
                            onClick={() => {
                                goToPlayground(env.deployedRevisionId)
                            }}
                        />
                    </Flex>
                    {selectedDeployedVariant && (
                        <ModifiedByText variant={selectedDeployedVariant} />
                    )}
                    {selectedDeployedVariant?.message && (
                        <Typography.Text type="secondary">
                            {selectedDeployedVariant?.message}
                        </Typography.Text>
                    )}
                </div>
            }
        >
            <Tag
                className="w-fit cursor-pointer py-[1px] px-2"
                onClick={(e) => e.stopPropagation()}
            >
                <Badge
                    text={formatVariantIdWithHash(env.deployedRevisionId as string)}
                    color={statusMap[env.name]?.badge ?? "transparent"}
                />
            </Tag>
        </Popover>
    )
}

export default VariantPopover
