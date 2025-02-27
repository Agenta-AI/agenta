import {useReducer} from "react"

export const useForceRemount = () => {
    return useReducer((x) => x + 1, 0)
}
