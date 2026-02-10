import {ArrowSquareOut} from "@phosphor-icons/react"
import {Badge, Button, Flex, Popover, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {statusMap} from "@/oss/components/VariantDetailsWithStatus/components/EnvironmentStatus"
import VariantNameCell from "@/oss/components/VariantNameCell"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {formatVariantIdWithHash} from "@/oss/lib/helpers/utils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Environment} from "@/oss/lib/Types"
import {moleculeBackedVariantAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

type VariantPopoverProps = {
    env: Environment
    selectedDeployedVariant: EnhancedVariant | undefined
} & React.ComponentProps<typeof Popover>

const ModifiedByText = ({variant}: {variant: EnhancedVariant}) => {
    const revisionData = useAtomValue(moleculeBackedVariantAtomFamily(variant.id)) as any
    const name: string | null =
        revisionData?.modifiedByDisplayName ??
        revisionData?.modifiedBy ??
        revisionData?.modified_by ??
        (variant as any)?.modifiedBy ??
        null
    if (!name || name === "-") return null
    return <Typography.Text className="font-normal">{name}</Typography.Text>
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
                        <VariantNameCell
                            revisionId={selectedDeployedVariant?.revision}
                            showBadges
                        />
                        {/* <VariantDetailsWithStatus
                            variantName={selectedDeployedVariant?.variantName}
                            revision={selectedDeployedVariant?.revision}
                            variant={selectedDeployedVariant}
                        /> */}

                        <Button
                            size="small"
                            icon={<ArrowSquareOut size={14} />}
                            className="flex items-center justify-center"
                            onClick={() => {
                                goToPlayground(env.deployed_app_variant_revision_id)
                            }}
                        />
                    </Flex>
                    {selectedDeployedVariant && (
                        <ModifiedByText variant={selectedDeployedVariant} />
                    )}
                    {selectedDeployedVariant?.commitMessage && (
                        <Typography.Text type="secondary">
                            {selectedDeployedVariant?.commitMessage}
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
                    text={formatVariantIdWithHash(env.deployed_app_variant_revision_id as string)}
                    color={statusMap[env.name]?.badge ?? "transparent"}
                />
            </Tag>
        </Popover>
    )
}

export default VariantPopover
