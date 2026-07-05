import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {useUserDisplayName} from "@agenta/entities/shared/user"
import type {Workflow} from "@agenta/entities/workflow"
import {VariantNameCell} from "@agenta/entity-ui/variant"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Badge as AntBadge, Flex, Popover} from "antd"

import {statusMap} from "@/oss/components/VariantDetailsWithStatus/components/EnvironmentStatus"
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
    return <span className="font-normal">{resolvedName}</span>
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
                            className="flex items-center justify-center"
                            onClick={() => {
                                goToPlayground(env.deployedRevisionId)
                            }}
                            variant="outline"
                            size="icon-sm"
                        >
                            {<ArrowSquareOut size={14} />}
                        </Button>
                    </Flex>
                    {selectedDeployedVariant && (
                        <ModifiedByText variant={selectedDeployedVariant} />
                    )}
                    {selectedDeployedVariant?.message && (
                        <span className="text-muted-foreground">
                            {selectedDeployedVariant?.message}
                        </span>
                    )}
                </div>
            }
        >
            <Badge
                className="w-fit cursor-pointer py-[1px] px-2"
                onClick={(e) => e.stopPropagation()}
                variant="secondary"
            >
                <AntBadge
                    text={formatVariantIdWithHash(env.deployedRevisionId as string)}
                    color={statusMap[env.name]?.badge ?? "transparent"}
                />
            </Badge>
        </Popover>
    )
}

export default VariantPopover
