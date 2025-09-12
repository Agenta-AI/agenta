import {Drawer} from "antd"

import PlaygroundVariantConfig from "@/oss/components/Playground/Components/PlaygroundVariantConfig"
import useDrawerWidth from "@/oss/components/Playground/hooks/useDrawerWidth"
import {usePlaygroundLayout} from "@/oss/components/Playground/hooks/usePlaygroundLayout"

import {PromptComparisonFocusDrawerProps} from "./types"

const PromptComparisonFocusDrawer: React.FC<PromptComparisonFocusDrawerProps> = ({...props}) => {
    const {drawerWidth} = useDrawerWidth()
    const {displayedVariants} = usePlaygroundLayout()

    const onClose = (e: any) => {
        props?.onClose?.(e)
    }

    return (
        <>
            <Drawer
                placement={"right"}
                classNames={{body: "!p-0"}}
                width={drawerWidth}
                onClose={onClose}
                title="Variant view"
                {...props}
            >
                <section className="[&::-webkit-scrollbar]:w-0 grow h-full w-full overflow-auto flex items-start">
                    {(displayedVariants || []).map((variantId) => (
                        <div
                            key={variantId}
                            className="[&::-webkit-scrollbar]:w-0 min-w-[400px] flex-1 h-full overflow-y-auto !overflow-x-hidden flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)]"
                        >
                            <PlaygroundVariantConfig variantId={variantId as string} />
                        </div>
                    ))}
                </section>
            </Drawer>
        </>
    )
}

export default PromptComparisonFocusDrawer
