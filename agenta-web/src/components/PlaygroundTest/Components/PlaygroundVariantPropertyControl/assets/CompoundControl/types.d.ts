import type {CompoundOption} from "../../../../hooks/usePlayground/types"

export interface CompoundControlProps {
    value: any
    options: CompoundOption[]
    onChange: (value: any) => void
    nullable?: boolean
    placeholder?: string
}
