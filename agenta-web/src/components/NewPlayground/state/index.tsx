import {InitialStateType} from "./types"

export const initialState: InitialStateType = {
    variants: [],
    selected: [],
    dirtyStates: new Map<string, boolean>(),
    generationData: {} as InitialStateType["generationData"],
}
