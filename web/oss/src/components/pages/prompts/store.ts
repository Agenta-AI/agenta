import {atom} from "jotai"

import {createInfiniteDatasetStore} from "@/oss/components/InfiniteVirtualTable"

import {PromptsTableRow} from "./types"

export const promptsTableMetaAtom = atom({projectId: null as string | null})

export const promptsDatasetStore = createInfiniteDatasetStore<
    PromptsTableRow,
    PromptsTableRow,
    {projectId: string | null}
>({
    key: "prompts-table",
    metaAtom: promptsTableMetaAtom,
    createSkeletonRow: ({rowKey}) => ({
        key: rowKey,
        __isSkeleton: true,
        type: "folder",
        id: rowKey,
        name: "",
        description: "",
        children: [],
    }),
    mergeRow: ({skeleton, apiRow}) => ({
        ...skeleton,
        ...(apiRow ?? {}),
        __isSkeleton: apiRow?.__isSkeleton ?? skeleton.__isSkeleton,
    }),
    isEnabled: () => false,
    fetchPage: async () => ({
        rows: [],
        totalCount: 0,
        hasMore: false,
        nextOffset: null,
        nextCursor: null,
        nextWindowing: null,
    }),
})
