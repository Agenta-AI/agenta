import {isDemo, formatVariantIdWithHash} from "@/lib/helpers/utils"
import {Environment, Variant} from "@/lib/Types"
import {fetchSingleProfile} from "@/services/api"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Badge, Button, Popover, Tag, theme, Typography} from "antd"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"

const {useToken} = theme

type VariantPopoverProps = {
    env: Environment
    selectedDeployedVariant: Variant | undefined
} & React.ComponentProps<typeof Popover>

const VariantPopover = ({env, selectedDeployedVariant, ...props}: VariantPopoverProps) => {
    const router = useRouter()
    const {token} = useToken()
    const appId = router.query.app_id as string
    const [variantUsername, setVariantUsername] = useState<string>()

    useEffect(() => {
        const handleFetchVariantProfile = async () => {
            try {
                if (!selectedDeployedVariant) return
                const data = await fetchSingleProfile(selectedDeployedVariant.modifiedById)
                setVariantUsername(data.username)
            } catch (error) {
                console.error(error)
            }
        }

        handleFetchVariantProfile()
    }, [selectedDeployedVariant])

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
                    {selectedDeployedVariant && (
                        <Typography.Text className="font-normal">{variantUsername}</Typography.Text>
                    )}
                </div>
            }
        >
            <Tag
                className="w-fit cursor-pointer py-[1px] px-2"
                onClick={(e) => e.stopPropagation()}
            >
                <Badge
                    color={token.colorPrimary}
                    text={formatVariantIdWithHash(env.deployed_app_variant_id as string)}
                />
            </Tag>
        </Popover>
    )
}

export default VariantPopover
