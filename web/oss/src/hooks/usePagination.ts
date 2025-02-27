import {useState} from "react"

interface UsePaginationProps<T> {
    items: T[]
    initialPageSize?: number
}

interface UsePaginationReturn<T> {
    paginatedItems: T[]
    currentPage: number
    pageSize: number
    totalItems: number
    onPageChange: (page: number, size?: number) => void
}

function usePagination<T>({
    items,
    initialPageSize = 10,
}: UsePaginationProps<T>): UsePaginationReturn<T> {
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(initialPageSize)

    const startIndex = (currentPage - 1) * pageSize
    const paginatedItems = items.slice(startIndex, startIndex + pageSize)

    const onPageChange = (page: number, size?: number) => {
        setCurrentPage(page)
        if (size !== undefined) setPageSize(size)
    }

    return {
        paginatedItems,
        currentPage,
        pageSize,
        totalItems: items.length,
        onPageChange,
    }
}

export default usePagination
