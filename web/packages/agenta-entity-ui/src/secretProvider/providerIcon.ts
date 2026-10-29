/**
 * The mark shown beside a provider, in the catalog and in the connections table.
 *
 * Every provider with a logo gets it. The kinds that have none are not companies — an
 * OpenAI-compatible endpoint is an address the user supplies — so they get a plug rather than a
 * blank column that reads as a missing asset.
 */
import type {ComponentType} from "react"

import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {Plugs} from "@phosphor-icons/react"

export const providerIconFor = (kind: string): ComponentType<{className?: string}> =>
    getProviderIcon(kind) ?? Plugs
