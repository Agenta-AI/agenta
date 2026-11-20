import {createContext} from "react"

/** Where the sidebar renders: the desktop rail (and the tablet sheet), or the phone sheet. */
export type SidebarLayout = "rail" | "phone"

/** Set by the mount: the phone sidebar sheet provides "phone"; everything else is the rail. */
export const SidebarLayoutContext = createContext<SidebarLayout>("rail")

/** A row in the phone sheet: the 44 px touch minimum, with the phone's 15 px text. */
export const PHONE_ROW_CLASS = "h-11 text-[15px] leading-[44px]"
