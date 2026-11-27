import {createContext} from "react"

/** Where the sidebar renders: the desktop rail (and the tablet sheet), or the phone sheet. */
export type SidebarLayout = "rail" | "phone"

/** Set by the mount: the phone sidebar sheet provides "phone"; everything else is the rail. */
export const SidebarLayoutContext = createContext<SidebarLayout>("rail")
