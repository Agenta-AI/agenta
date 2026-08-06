/**
 * Trigger deliveries paginated store — feeds the InfiniteVirtualTable in the
 * deliveries drawer.
 *
 * The deliveries endpoint isn't windowed yet (it returns the full set for one
 * subscription OR one schedule), so we fetch once and report `hasMore: false`;
 * the IVT still virtualizes the rows. `triggerDeliveriesOwnerAtom` is the single
 * input — the drawer sets it on open and the store refetches.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import type {Atom} from "jotai"

import {createPaginatedEntityStore} from "../../shared/paginated"
import type {InfiniteTableFetchResult} from "../../shared/tableTypes"
import {queryTriggerDeliveries} from "../api"
import type {TriggerDelivery} from "../core/types"

export interface DeliveriesOwner {
    kind: "subscription" | "schedule"
    id: string
}

/** Table row = the delivery plus the `key`/skeleton flag the IVT manages. */
export type TriggerDeliveryRow = TriggerDelivery & {key: string; __isSkeleton?: boolean}

interface TriggerDeliveriesMeta {
    projectId: string | null
    owner: DeliveriesOwner | null
}

/** Drives the store's query — set by the deliveries drawer when it opens. */
export const triggerDeliveriesOwnerAtom = atom<DeliveriesOwner | null>(null)

const triggerDeliveriesMetaAtom: Atom<TriggerDeliveriesMeta> = atom((get) => ({
    projectId: get(projectIdAtom),
    owner: get(triggerDeliveriesOwnerAtom),
}))

function deliveryRowId(delivery: TriggerDelivery): string {
    return delivery.id ?? delivery.event_id
}

export const triggerDeliveriesPaginatedStore = createPaginatedEntityStore<
    TriggerDeliveryRow,
    TriggerDelivery,
    TriggerDeliveriesMeta
>({
    entityName: "trigger_delivery",
    metaAtom: triggerDeliveriesMetaAtom,
    fetchPage: async ({meta}): Promise<InfiniteTableFetchResult<TriggerDelivery>> => {
        const owner = meta.owner
        if (!owner?.id) {
            return {
                rows: [],
                totalCount: 0,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
                hasMore: false,
            }
        }
        const {deliveries, count} = await queryTriggerDeliveries(
            owner.kind === "subscription" ? {subscription_id: owner.id} : {schedule_id: owner.id},
        )
        return {
            rows: deliveries,
            totalCount: count,
            nextCursor: null,
            nextOffset: null,
            nextWindowing: null,
            hasMore: false,
        }
    },
    rowConfig: {
        getRowId: deliveryRowId,
        skeletonDefaults: {event_id: ""} as Partial<TriggerDeliveryRow>,
    },
    transformRow: (apiRow): TriggerDeliveryRow => ({...apiRow, key: deliveryRowId(apiRow)}),
    isEnabled: (meta) => Boolean(meta?.owner?.id),
    listCountsConfig: {totalCountMode: "total"},
})
