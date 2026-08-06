/**
 * DrillInContext.tsx
 *
 * React Context for providing drill-in capability to nested components like LongTextNode.
 * This allows LongTextNode to know whether drill-in is enabled without prop drilling.
 */
import {createContext, useContext} from "react"

interface DrillInContextValue {
    /** Whether drill-in functionality is enabled */
    enabled: boolean
    /** Whether escaped JSON string characters should be rendered as readable text in LongTextNode */
    decodeEscapedJsonStrings: boolean
}

const DrillInContext = createContext<DrillInContextValue>({
    enabled: false,
    decodeEscapedJsonStrings: false,
})

export const DrillInProvider = DrillInContext.Provider

export const useDrillInContext = () => useContext(DrillInContext)

export default DrillInContext
