import {SWRConfiguration, SWRResponse} from "swr"
import {InitialStateType} from "../../state/types"

export type PlaygroundStateData = InitialStateType & {
    dirtyStates?: Map<string, boolean>
}

export interface UsePlaygroundStateOptions<
    Data = PlaygroundStateData,
    Error = any,
    Fn extends (...args: any[]) => any = (...args: any[]) => any,
> extends SWRConfiguration<Data, Error, Fn> {
    service?: string
    appId?: string
    projectId?: string
    hookId?: string
    selector?: (state: InitialStateType) => any
    compare?: (a: Data | undefined, b: Data | undefined) => boolean
    neverFetch?: boolean
    variantId?: string
    cache?: Map<string, SWRResponse<Data, Error>>
}
