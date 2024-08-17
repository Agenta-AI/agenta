import {isDemo, splitVariantId} from "@/lib/helpers/utils"
import {Environment, Variant} from "@/lib/Types"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Popover, Tag, Typography} from "antd"
import {useRouter} from "next/router"
import React from "react"

type VariantPopoverProps = {
    env: Environment
    selectedDeployedVariant: Variant | undefined
} & React.ComponentProps<typeof Popover>

const VariantPopover = ({env, selectedDeployedVariant, ...props}: VariantPopoverProps) => {
    const router = useRouter()
    const appId = router.query.app_id as string
    return (
        <Popover
            {...props}
            placement="bottom"
            trigger={"hover"}
            overlayStyle={{width: 256}}
            arrow={false}
            title={
                <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <Typography.Text>{env.deployed_variant_name}</Typography.Text>

                        <Button
                            size="small"
                            icon={<ArrowSquareOut size={14} />}
                            className="flex items-center justify-center"
                            href={`/apps/${appId}/playground?variant=${env.deployed_variant_name}`}
                        />
                    </div>
                    {selectedDeployedVariant && isDemo() && (
                        <Typography.Text className="font-normal">
                            {selectedDeployedVariant.modifiedBy.username}
                        </Typography.Text>
                    )}
                </div>
            }
        >
            <Tag className="w-fit" onClick={(e) => e.stopPropagation()}>
                {splitVariantId(env.deployed_app_variant_id as string)}
            </Tag>
        </Popover>
    )
}

export default VariantPopover
