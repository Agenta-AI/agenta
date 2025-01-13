import {memo} from "react"
import {Play} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {GenerationComparisonHeaderProps} from "./types"

const GenerationComparisonHeader = ({}: GenerationComparisonHeaderProps) => {
    return (
        <section className="flex items-center justify-between gap-2 px-4 py-2 bg-[#F5F7FA]">
            <Typography className="text-[16px] leading-[18px] font-[600]">Generations</Typography>

            <div className="flex items-center gap-2">
                <Button size="small">Clear</Button>

                <Button type="primary" icon={<Play size={14} />} size="small">
                    Run
                </Button>
            </div>
        </section>
    )
}

export default memo(GenerationComparisonHeader)
