import {createContext} from "react"

/** Where the sidebar renders: the desktop rail (and the tablet sheet), or the phone sheet. */
export type SidebarLayout = "rail" | "phone"

/** Set by the mount: the phone sidebar sheet provides "phone"; everything else is the rail. */
export const SidebarLayoutContext = createContext<SidebarLayout>("rail")

/** A row in the phone sheet: a 32 px menu row (SIZE-02: nothing gets bigger on a compact window). */
export const PHONE_ROW_CLASS = "h-8 text-sm leading-8"
