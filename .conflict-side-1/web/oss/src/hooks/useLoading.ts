import {useCallback, useReducer} from "react"

type State = Record<string, boolean>
type Setter = (type: string, value: boolean) => void

export const useLoading = (types: string[]): [State, Setter] => {
    const initialState: State = {}
    types.forEach((type) => (initialState[type] = false))

    const [loading, setLoading] = useReducer(
        (state: State, action: {type: string; value: boolean}) => ({
            ...state,
            [action.type]: action.value,
        }),
        initialState,
    )

    const setter: Setter = useCallback((type, value) => {
        setLoading({type, value})
    }, [])

    return [loading, setter]
}
