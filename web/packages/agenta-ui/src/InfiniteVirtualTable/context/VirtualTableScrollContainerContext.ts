import {createContext, useContext} from "react"

const VirtualTableScrollContainerContext = createContext<HTMLDivElement | null>(null)

export const useVirtualTableScrollContainer = () => useContext(VirtualTableScrollContainerContext)

export default VirtualTableScrollContainerContext
