import {act, cleanup, renderHook} from "@testing-library/react"
import {afterEach, expect, it, vi} from "vitest"

import {useToolCatalogIntegrations} from "../../../../packages/agenta-entities/src/gatewayTool/hooks/useToolCatalogIntegrations"

const query = vi.hoisted(() => ({
    data: {pages: Array.from({length: 12}, () => ({integrations: [], total: 200}))},
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
}))
vi.mock("jotai", () => ({atom: vi.fn(), useAtomValue: () => query, useSetAtom: () => vi.fn()}))
vi.mock("jotai-tanstack-query", () => ({atomWithInfiniteQuery: vi.fn()}))
vi.mock("@agenta/shared/api/persist", () => ({catalogPersister: {}}))
vi.mock("../../../../packages/agenta-entities/src/gatewayTool/api", () => ({}))
afterEach(cleanup)
it("requests the next page when reopening a catalog with many cached pages", () => {
    const {result} = renderHook(() => useToolCatalogIntegrations())
    expect(query.fetchNextPage).not.toHaveBeenCalled()
    act(() => result.current.requestMore())
    expect(query.fetchNextPage).toHaveBeenCalledOnce()
})
