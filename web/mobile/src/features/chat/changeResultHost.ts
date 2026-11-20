import {createContext} from "react"

/** What the conversation lets a change result row do (task 26.1). */
export interface ChangeResultHost {
    /** The reader cannot send here: no Revert and no Try again. */
    readOnly: boolean
    /** Sends a message as the person, as the composer does. */
    send?: (text: string) => void
}

/**
 * Provided by the conversation; a transcript with no provider is read only. Its own file, so the
 * conversation does not load the rows' version-history code.
 */
export const ChangeResultHostContext = createContext<ChangeResultHost>({readOnly: true})
