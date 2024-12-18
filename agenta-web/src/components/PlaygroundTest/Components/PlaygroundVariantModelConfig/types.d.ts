import {type MouseEvent} from "react"

type PlaygroundVariantModelBase = {
    variantId: string
}

export interface PlaygroundVariantModelConfigProps extends PlaygroundVariantModelBase {
    promptIndex: number
}

export interface PlaygroundVariantModelConfigModalProps extends PlaygroundVariantModelBase {
    properties: {
        key: string
        configKey: string
        valueKey: string
        value: any
    }[]
    handleSave: () => void
    handleClose: (e: MouseEvent<HTMLElement>) => void
}

export interface PlaygroundVariantModelConfigTitleProps {
    handleReset: (e: MouseEvent<HTMLElement>) => void
}
