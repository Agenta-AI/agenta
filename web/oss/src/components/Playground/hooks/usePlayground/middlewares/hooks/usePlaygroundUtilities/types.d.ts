import {PlaygroundSWRConfig, PlaygroundStateData} from "../../../../types"

export interface PlaygroundUtilitiesConfig
    extends Partial<Pick<PlaygroundSWRConfig<PlaygroundStateData>, "variantId">> {
    debug?: boolean
    name: string
    hookId?: string
}

export interface PlaygroundUtilities {
    addToValueReferences: (key: string) => void
    logger: (log: string, ...args: any[]) => void
    valueReferences: React.MutableRefObject<string[]>
    checkInvalidSelector: () => void
}
