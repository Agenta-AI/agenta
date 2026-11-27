import {createContext, useContext, type ReactNode} from "react"

import type {IconMap} from "streamdown"

export interface ValueViewOptions {
    /** The host's prose classes for markdown (the app's `chatProseClassName`). */
    markdownClassName: string
    /** The host's glyphs for the copy control of a code fence. */
    markdownIcons?: Partial<IconMap>
}

const DEFAULT_OPTIONS: ValueViewOptions = {markdownClassName: "text-body"}

const ValueViewContext = createContext<ValueViewOptions>(DEFAULT_OPTIONS)

/** Gives every value view below it the host's markdown look. */
export const ValueViewProvider = ({
    children,
    ...options
}: ValueViewOptions & {children: ReactNode}) => (
    <ValueViewContext.Provider value={options}>{children}</ValueViewContext.Provider>
)

export const useValueViewOptions = () => useContext(ValueViewContext)
