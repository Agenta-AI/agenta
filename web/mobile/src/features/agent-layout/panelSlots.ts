import type {ReactNode} from "react"

import {atom} from "jotai"

/**
 * Seams that later milestones fill. Each holds a render function; null keeps the default.
 *
 * - `builderPanelSlotAtom`: the Builder content of the panel (wave 2, the builder panel). While
 *   it is null the Builder icon is hidden.
 * - `channelsTabSlotAtom`: the Channels tab body of Configuration (task 23.3). While it is null
 *   the tab shows the production Channels card.
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

export const channelsTabSlotAtom = atom<
    ((props: {agentId: string; workspaceId: string; projectId: string}) => ReactNode) | null
>(null)
