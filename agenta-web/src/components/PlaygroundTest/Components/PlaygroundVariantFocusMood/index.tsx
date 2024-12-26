import React, {useState, useEffect} from "react"
import {Button, Drawer, Space, Typography} from "antd"
import {Props} from "./types"
import {CaretLeft, CaretRight, FloppyDiskBack} from "@phosphor-icons/react"
import DeployButton from "../../assets/DeployButton"
import Version from "../../assets/Version"
import usePlayground from "../../hooks/usePlayground"

const PlaygroundVariantFocusMood: React.FC<Props> = ({variantId, ...props}) => {
    const [drawerWidth, setDrawerWidth] = useState<string>("100vw")
    const {variantName, revision} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantConfigHeader",
        variantSelector: (variant) => ({
            variantName: variant?.variantName,
            revision: variant?.revision,
        }),
    })

    // Set the drawer width to be the full width of the screen minus the sider width
    useEffect(() => {
        const siderElement = document.querySelector(".ant-layout-sider")
        if (siderElement) {
            const siderWidth = siderElement.clientWidth
            setDrawerWidth(`calc(100vw - ${siderWidth}px)`)
        }
    }, [])

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
