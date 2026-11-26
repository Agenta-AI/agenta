import {createContext} from "react"

export interface DriveLinkItem {
    path: string
    isFolder: boolean
}

/** The host's "Copy link" for a drive item; null (no menu entry) where the URL does not mirror the drive. */
export const DriveLinkContext = createContext<((item: DriveLinkItem) => void) | null>(null)
