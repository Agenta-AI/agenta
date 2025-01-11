import {useState} from "react"
import {Button, Drawer, Radio, Space, Typography} from "antd"
import {CaretDown, CaretUp, FloppyDisk, Play} from "@phosphor-icons/react"
import useDrawerWidth from "../../../hooks/useDrawerWidth"
import {GenerationFocusDrawerProps} from "./types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import GenerationComparisionCompletionInput from "../../PlaygroundGenerationComparisionView/GenerationComparisionCompletionInput"

const GenerationFocusDrawer: React.FC<GenerationFocusDrawerProps> = ({
    type,
    variantId,
    ...props
}) => {
    const [format, setFormat] = useState("pretty")
    const {drawerWidth} = useDrawerWidth()
    const {viewType, displayedVariants} = usePlayground()

    const onClose = (e: any) => {
        props?.onClose?.(e)
    }
    return (
        <>
            <Drawer
                placement={"right"}
                width={drawerWidth}
                onClose={onClose}
                classNames={{body: "!p-0"}}
                {...props}
                title={
                    <div className="!w-full flex items-center justify-between">
                        <Space className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                                <Button icon={<CaretUp size={14} />} type="text" />
                                <Button icon={<CaretDown size={14} />} type="text" />
                            </div>

                            <Typography.Text>Generation</Typography.Text>
                        </Space>
                        <Space className="flex items-center gap-2">
                            <div>
                                <Radio.Group
                                    value={format}
                                    onChange={(e) => setFormat(e.target.value)}
                                >
                                    <Radio.Button value="pretty">Pretty</Radio.Button>
                                    <Radio.Button value="json">JSON</Radio.Button>
                                    <Radio.Button value="yaml">YAML</Radio.Button>
                                </Radio.Group>
                            </div>

                            <Button icon={<Play size={14} />}>Re run</Button>
                            <Button icon={<FloppyDisk size={14} />}>Add to test set</Button>
                        </Space>
                    </div>
                }
            >
                <GenerationComparisionCompletionInput variantId={variantId} />
            </Drawer>
        </>
    )
}

export default GenerationFocusDrawer
