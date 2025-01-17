import {memo, useCallback} from "react"
import {Play} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {GenerationComparisonHeaderProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"

const GenerationComparisonHeader = ({}: GenerationComparisonHeaderProps) => {
    const {runTests, mutate} = usePlayground()

    const clearGeneration = useCallback(() => {
        mutate(
            (state) => {
                const clonedState = structuredClone(state)
                if (!clonedState) return state

                const generationMetadata = clonedState.generationData.__metadata
                const metadata =
                    getMetadataLazy<ArrayMetadata<ObjectMetadata>>(generationMetadata)?.itemMetadata
                if (!metadata) return clonedState

                const inputKeys = Object.keys(metadata.properties)
                const newRow = createInputRow(inputKeys, metadata)
                clonedState.generationData.value = [newRow]

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    return (
        <section className="flex items-center justify-between gap-2 px-4 py-2 bg-[#F5F7FA]">
            <Typography className="text-[16px] leading-[18px] font-[600]">Generations</Typography>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={clearGeneration}>
                    Clear
                </Button>

                <Button
                    type="primary"
                    icon={<Play size={14} />}
                    size="small"
                    onClick={() => runTests?.()}
                >
                    Run
                </Button>
            </div>
        </section>
    )
}

export default memo(GenerationComparisonHeader)
