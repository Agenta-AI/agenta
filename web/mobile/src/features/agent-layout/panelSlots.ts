import type {ReactNode} from "react"

import {atom} from "jotai"

/**
 * Seams that later milestones fill. Each holds a render function; null keeps the default.
 *
 * - `builderPanelSlotAtom`: the Builder content of the panel (wave 2, the builder panel). While
 *   it is null the Builder icon is hidden.
 */
export const builderPanelSlotAtom = atom<
    | ((props: {
          agentId: string
          sessionId: string
          workspaceId: string
          projectId: string
      }) => ReactNode)
    | null
>(null)
