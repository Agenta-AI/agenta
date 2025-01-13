import {useState} from "react"
import {Drawer} from "antd"
import useDrawerWidth from "../../../hooks/useDrawerWidth"
import {GenerationFocusDrawerProps} from "./types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import GenerationComparisionCompletionInput from "../../PlaygroundGenerationComparisionView/GenerationComparisionCompletionInput"
import GenerationComparisionCompletionOuput from "../../PlaygroundGenerationComparisionView/GenerationComparisionCompletionOuput"
import GenerationFocusDrawerHeader from "./assets/GenerationFocusDrawerHeader"
import GenerationOutputNavigator from "./assets/GenerationOutputNavigator"
import clsx from "clsx"

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
        <Drawer
            placement={"right"}
            width={drawerWidth}
            onClose={onClose}
            classNames={{body: "!p-0"}}
            {...props}
            title={
                <GenerationFocusDrawerHeader
                    format={format}
                    setFormat={setFormat}
                    variantId={variantId}
                />
            }
        >
            <GenerationComparisionCompletionInput
                variantId={variantId}
                rowClassName="!border-none"
                inputOnly={true}
            />
            <GenerationOutputNavigator />

            <div className="w-full flex items-start overflow-x-auto">
                {(displayedVariants || []).map((variantId) => (
                    <div className={clsx({"w-[400px]": viewType === "comparison"})}>
                        <GenerationComparisionCompletionOuput
                            variantId={variantId}
                            focusDisable={true}
                        />
                    </div>
                ))}
            </div>
        </Drawer>
    )
}

export default GenerationFocusDrawer
