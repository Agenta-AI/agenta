import {DrawerProps} from "antd"
import {Enhanced} from "@/components/PlaygroundTest/assets/utilities/genericTransformer/types"
import {InputType} from "@/components/PlaygroundTest/assets/utilities/transformer/types"

export interface GenerationFocusDrawerProps extends DrawerProps {
    type: "completion" | "chat"
    variantId: string
    rowId: string
    loadNextRow: () => void
    loadPrevRow: () => void
    inputRows: Enhanced<InputType<string[]>>[]
}
