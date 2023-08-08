import {SetStateAction, useCallback, useEffect, useRef, useState} from "react"

type Callback<T> = (value?: T) => void
type DispatchWithCallback<T> = (value: T, callback?: Callback<T>) => void

/**
 * This hook mimcs the setState behaviour of class components. An optional callback can be passed
 * as the second parameter of setState to be called when the state has been changed
 *
 * @param initialState
 */
function useStateCallback<T>(
    initialState: T | (() => T),
): [T, DispatchWithCallback<SetStateAction<T>>] {
    const [state, _setState] = useState(initialState)

    const callbackRef = useRef<Callback<T>>()
    const isFirstCallbackCall = useRef<boolean>(true)

    const setState = useCallback(
        (setStateAction: SetStateAction<T>, callback?: Callback<T>): void => {
            callbackRef.current = callback
            _setState(setStateAction)
        },
        [],
    )

    useEffect(() => {
        if (isFirstCallbackCall.current) {
            isFirstCallbackCall.current = false
            return
        }
        typeof callbackRef.current === "function" && callbackRef.current(state)
    }, [state])

    return [state, setState]
}

export default useStateCallback
