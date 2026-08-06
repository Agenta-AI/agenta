export const emptyFetchResult = <TRow>(totalCount: number | null = null) => ({
    rows: [] as TRow[],
    totalCount,
    hasMore: false,
    nextCursor: null,
    nextOffset: null,
    nextWindowing: null,
})

export const getCursorOffset = (cursor: string | null | undefined) =>
    cursor ? Number.parseInt(cursor, 10) || 0 : 0

export const createDateDescComparator =
    <TRow>(getDate: (row: TRow) => string | null | undefined) =>
    (a: TRow, b: TRow) => {
        const aDate = getDate(a)
        const bDate = getDate(b)
        const aTime = aDate ? Date.parse(aDate) : 0
        const bTime = bDate ? Date.parse(bDate) : 0
        return bTime - aTime
    }
