import {SWRConfiguration} from "swr"
import {InitialStateType} from "../../state/types"

export interface UsePlaygroundStateOptions extends SWRConfiguration {
    service?: string
    appId?: string
    projectId?: string
    hookId?: string
    selector?: (state: InitialStateType) => any
    compare?: (a: InitialStateType | undefined, b: InitialStateType | undefined) => boolean
    neverFetch?: boolean
}
