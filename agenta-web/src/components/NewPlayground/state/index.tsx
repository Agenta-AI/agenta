import {InitialStateType} from "./types"
import {atom, useAtom} from "jotai"

export const specAtom = atom<InitialStateType["spec"]>(undefined)

export const initialState: InitialStateType = {
    variants: [],
    selected: [],
    dirtyStates: new Map<string, boolean>(),
    generationData: {} as InitialStateType["generationData"],
}
