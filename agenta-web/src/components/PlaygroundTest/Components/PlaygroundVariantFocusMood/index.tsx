import {Button, Drawer, Space, Typography} from "antd"
import {Props} from "./types"
import {CaretLeft, CaretRight, FloppyDiskBack} from "@phosphor-icons/react"
import DeployButton from "../../assets/DeployButton"
import Version from "../../assets/Version"
import usePlayground from "../../hooks/usePlayground"
import useDrawerWidth from "../../hooks/useDrawerWidth"

const PlaygroundVariantFocusMood: React.FC<Props> = ({variantId, ...props}) => {
    const {drawerWidth} = useDrawerWidth()
    const {variantName, revision} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantConfigHeader",
        variantSelector: (variant) => ({
            variantName: variant?.variantName,
            revision: variant?.revision,
        }),
    })

    const onClose = (e: any) => {
        props?.onClose?.(e)
    }

    return (
        <>
            <Drawer
                placement={"right"}
                width={drawerWidth}
                onClose={onClose}
                {...props}
                title={
                    <div className="!w-full flex items-center justify-between">
                        <Space className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                                <Button icon={<CaretLeft size={14} />} type="text" />
                                <Button icon={<CaretRight size={14} />} type="text" />
                            </div>

                            <Typography.Text>{variantName}</Typography.Text>
                            <Version revision={revision} />
                        </Space>
                        <Space className="flex items-center gap-2">
                            <DeployButton />

                            <Button icon={<FloppyDiskBack size={14} />} type="primary">
                                Commit
                            </Button>
                        </Space>
                    </div>
                }
            ></Drawer>
        </>
    )
}

export default PlaygroundVariantFocusMood
