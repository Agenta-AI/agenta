import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {Input, Typography} from "antd"
import clsx from 'clsx'
import { GenerationTestViewProps } from "./types"

const {TextArea} = Input

const GenerationTestView = ({
    variantId,
    ...props
}: GenerationTestViewProps) => {
    const {inputKeys} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: (variant) => {
            const allInputKeys = variant.prompts.reduce((acc, prompt) => {
                return acc.concat(prompt.inputKeys.value || [])
            }, [])

            return {
                inputKeys: allInputKeys || []
            }
        },
    })

    console.log("inputKeys", inputKeys)

    return (
        <div>
            <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                GenerationTestView
            </Typography.Text>
            {
                inputKeys.map((inputKey) => {
                    return (
                        <div key={inputKey}>
                            <Typography.Text>
                                {inputKey}
                            </Typography.Text>
                            <TextArea
                                rows={4}
                                autoSize={{
                                    minRows: 4,
                                }}
                                // placeholder={placeholder}
                                // className={clsx(["border-0", "focus:ring-0"])}
                                // value={value}
                                // onChange={(e) => onChange(e.target.value)}
                            />
                        </div>
                    )
                })
            }
        </div>  
    )
}

export default GenerationTestView;