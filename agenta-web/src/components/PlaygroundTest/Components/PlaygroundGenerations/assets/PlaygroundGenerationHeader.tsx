import {Play} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import React from "react"

const PlaygroundGenerationHeader = () => {
    return (
        <section className="flex justify-between items-center gap-4 px-4 py-2">
            <Typography className="text-[16px] leading-[18px] font-[600]">Generations</Typography>

            <div className="flex items-center gap-2">
                <Button>Clear</Button>
                <Button>Load Test set</Button>
                <Button type="primary" icon={<Play size={14} />}>
                    Run all
                </Button>
            </div>
        </section>
    )
}

export default PlaygroundGenerationHeader
