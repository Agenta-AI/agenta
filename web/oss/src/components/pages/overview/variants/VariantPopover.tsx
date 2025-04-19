import {ArrowSquareOut} from "@phosphor-icons/react"
import {Badge, Button, Flex, Popover, Tag, Typography} from "antd"
import {useRouter} from "next/router"

import {statusMap} from "@/oss/components/VariantDetailsWithStatus/components/EnvironmentStatus"
import {formatVariantIdWithHash} from "@/oss/lib/helpers/utils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Environment} from "@/oss/lib/Types"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"

type VariantPopoverProps = {
    env: Environment
    selectedDeployedVariant: EnhancedVariant | undefined
} & React.ComponentProps<typeof Popover>

const VariantPopover = ({env, selectedDeployedVariant, ...props}: VariantPopoverProps) => {
    const router = useRouter()
    const appId = router.query.app_id as string

    return (
        <Popover
            {...props}
            placement="bottom"
            trigger={"hover"}
            overlayStyle={{minWidth: 256, maxWidth: 360}}
            arrow={false}
            title={
                <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-4">
                    <Flex justify="space-between">
                        <VariantDetailsWithStatus
                            variantName={selectedDeployedVariant?.variantName}
                            revision={selectedDeployedVariant?.revision}
                            variant={selectedDeployedVariant}
                        />

                        <Button
                            size="small"
                            icon={<ArrowSquareOut size={14} />}
                            className="flex items-center justify-center"
                            // href={`/apps/${appId}/playground?variant=${env.deployed_variant_name}`}
                            onClick={() => {
                                console.log("Variant Popover Action")
                                router.push({
                                    pathname: `/apps/${appId}/playground`,
                                    query: {
                                        revisions: JSON.stringify([
                                            env.deployed_app_variant_revision_id,
                                        ]),
                                    },
                                })
                            }}
                        />
                    </Flex>
                    {selectedDeployedVariant?.modifiedBy && (
                        <Typography.Text className="font-normal">
                            {selectedDeployedVariant.modifiedBy}
                        </Typography.Text>
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
