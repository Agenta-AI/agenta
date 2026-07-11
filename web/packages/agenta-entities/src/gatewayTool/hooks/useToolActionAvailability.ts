/**
 * Batched catalog-existence probe for connected-app tools: does each `(integration, action)`
 * pair still resolve against the tool catalog? Backs the "Unresolved" marking on agent-config
 * tool rows without opening each tool's drawer.
 *
 * Shares {@link toolActionDetailQueryFamily} (same query key the drawer uses), so probing a
 * row warms the drawer and vice versa — each pair costs at most one low-priority request per
 * staleTime window. Only a settled 404 maps to `"missing"`; transient errors stay `"unknown"`
 * so a network blip never paints a valid tool red.
 */
import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {isActionNotFoundError, toolActionDetailQueryFamily} from "./useToolActionDetail"

export type ToolActionAvailability = "unknown" | "resolved" | "missing"

// NUL join — action keys can contain most separators; matches gatewayToolIdentity's convention.
const AVAILABILITY_KEY_SEP = "\u0000"

export const toolActionAvailabilityKey = (integrationKey: string, actionKey: string): string =>
    [integrationKey, actionKey].join(AVAILABILITY_KEY_SEP)

export const useToolActionAvailability = (
    pairs: {integrationKey: string; actionKey: string}[],
): Record<string, ToolActionAvailability> => {
    // Key the derived atom on content, not array identity, so re-renders with an equal list
    // don't remount the query subscriptions.
    const serialized = useMemo(() => {
        const unique = new Map<string, [string, string]>()
        for (const p of pairs) {
            unique.set(toolActionAvailabilityKey(p.integrationKey, p.actionKey), [
                p.integrationKey,
                p.actionKey,
            ])
        }
        return JSON.stringify([...unique.keys()].sort().map((k) => unique.get(k)))
    }, [pairs])

    const combinedAtom = useMemo(() => {
        const parsed = JSON.parse(serialized) as [string, string][]
        return buildToolActionAvailabilityAtom(
            parsed.map(([integrationKey, actionKey]) => ({integrationKey, actionKey})),
        )
    }, [serialized])

    return useAtomValue(combinedAtom)
}

/** Derived read-only atom over the per-pair action-detail queries (exported for tests). */
export const buildToolActionAvailabilityAtom = (
    pairs: {integrationKey: string; actionKey: string}[],
) =>
    atom((get) => {
        const out: Record<string, ToolActionAvailability> = {}
        for (const {integrationKey, actionKey} of pairs) {
            if (!integrationKey || !actionKey) continue
            const q = get(toolActionDetailQueryFamily({integrationKey, actionKey}))
            out[toolActionAvailabilityKey(integrationKey, actionKey)] = q.isPending
                ? "unknown"
                : q.data?.action
                  ? "resolved"
                  : q.isError && !isActionNotFoundError(q.error)
                    ? "unknown"
                    : "missing"
        }
        return out
    })
