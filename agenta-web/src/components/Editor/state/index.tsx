import {Provider} from "jotai"
import {EditorStateProviderProps} from "./types"

export function EditorStateProvider({children}: EditorStateProviderProps) {
    return <Provider>{children}</Provider>
}
