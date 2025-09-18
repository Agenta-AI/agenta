import {atom} from "jotai"

export type PlaygroundNavigationRequest =
    | undefined
    | null
    | {
          appId: string
          selectedKeys?: (string | number)[]
      }

export const playgroundNavigationRequestAtom = atom<PlaygroundNavigationRequest>(null)

// Optional default selection scope for navigation. When set, the navigator will
// derive revisions from the scoped selection if the request doesn't provide selectedKeys.
export const navigationSelectionScopeAtom = atom<string>("overview/recent")
