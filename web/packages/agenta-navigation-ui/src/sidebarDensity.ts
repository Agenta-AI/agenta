import {createContext} from "react"

/** "rail": the desktop rail's 28 px rows. "touch": 44 px rows for the phone sidebar sheet. */
export type SidebarDensity = "rail" | "touch"

/** Set by the mount: the phone sidebar sheet provides "touch"; everything else is the rail. */
export const SidebarDensityContext = createContext<SidebarDensity>("rail")

/** The row size in the sheet: the 44 px touch minimum, with the phone's 15 px text. */
export const TOUCH_ROW_CLASS = "h-11 text-[15px] leading-[44px]"
