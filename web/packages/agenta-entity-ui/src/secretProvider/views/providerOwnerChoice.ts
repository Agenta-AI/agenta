import {createContext} from "react"

import type {ProviderOwnerChoice} from "../ProviderConnectionCard"

/**
 * "Who can use it" for a new connection of a kind. Settings › AI providers provides it for
 * someone who may manage the organization's connections; elsewhere a new connection is the
 * project's.
 */
export const ProviderOwnerChoiceContext = createContext<
    ((kind: string) => ProviderOwnerChoice | undefined) | null
>(null)
