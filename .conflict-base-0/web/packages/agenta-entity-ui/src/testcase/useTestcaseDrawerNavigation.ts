import {useCallback, useMemo} from "react"

export interface TestcaseDrawerNavigation {
    currentIndex: number
    hasPrevious: boolean
    hasNext: boolean
    handlePrevious: () => void
    handleNext: () => void
}

export interface UseTestcaseDrawerNavigationParams<TRow> {
    rows: TRow[]
    getRowId: (row: TRow) => string | null | undefined
    currentRowId: string | null
    onNavigate: (target: TRow) => void
}

export function useTestcaseDrawerNavigation<TRow>({
    rows,
    getRowId,
    currentRowId,
    onNavigate,
}: UseTestcaseDrawerNavigationParams<TRow>): TestcaseDrawerNavigation {
    const currentIndex = useMemo(() => {
        if (!currentRowId) return -1
        return rows.findIndex((row) => getRowId(row) === currentRowId)
    }, [rows, currentRowId, getRowId])

    const handlePrevious = useCallback(() => {
        if (currentIndex <= 0) return
        const target = rows[currentIndex - 1]
        if (!target) return
        onNavigate(target)
    }, [currentIndex, rows, onNavigate])

    const handleNext = useCallback(() => {
        if (currentIndex < 0 || currentIndex >= rows.length - 1) return
        const target = rows[currentIndex + 1]
        if (!target) return
        onNavigate(target)
    }, [currentIndex, rows, onNavigate])

    return {
        currentIndex,
        hasPrevious: currentIndex > 0,
        hasNext: currentIndex >= 0 && currentIndex < rows.length - 1,
        handlePrevious,
        handleNext,
    }
}
