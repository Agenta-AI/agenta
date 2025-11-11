import {HTMLProps} from "react"

export interface TabLabelProps extends HTMLProps<HTMLDivElement> {
    tabTitle: string
    completed?: boolean
}
