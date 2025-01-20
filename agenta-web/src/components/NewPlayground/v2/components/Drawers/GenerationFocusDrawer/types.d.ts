import {DrawerProps} from "antd"
import {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {InputType} from "@/components/NewPlayground/assets/utilities/transformer/types"

export interface GenerationFocusDrawerProps extends DrawerProps {
    type: "completion" | "chat"
    variantId: string
    rowId: string
    loadNextRow: () => void
    loadPrevRow: () => void
    inputRows: Enhanced<InputType<string[]>>[]
}

export type OutputFormat = "PRETTY" | "JSON" | "YAML"
