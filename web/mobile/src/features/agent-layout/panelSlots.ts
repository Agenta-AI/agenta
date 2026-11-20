import type {ReactNode} from "react"

import {atom} from "jotai"

import type {BuilderPanelProps} from "../builder/BuilderPanel"
import {renderBuilderPanel} from "../builder/renderBuilderPanel"

/**
 * The Builder content of the panel, as a render function; the Builder icon shows while it is
 * set. A read-only atom: jotai would read a function given as the initial value as its getter.
 * It takes no session id: the builder reads the page session itself (`pageSessionIdAtom`), so a
 * session switch does not reach into it (design D6).
 */
export const builderPanelSlotAtom = atom<((props: BuilderPanelProps) => ReactNode) | null>(
    () => renderBuilderPanel,
)
