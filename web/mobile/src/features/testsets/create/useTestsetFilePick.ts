import {useCallback, useRef, useState} from "react"

import type {TestsetFileType} from "@agenta/entities/testset"

import {checkTestsetFile} from "./testsetFileCheck"

export interface TestsetFilePick {
    /** The file, set only once it passed the check. */
    file: File | null
    fileType: TestsetFileType | null
    rows: Record<string, unknown>[]
    /** Every data row in the file; `rows` holds the first few. */
    totalRows: number
    /** Why the last file was refused. */
    error: string | null
    /** Resolves true when this file was accepted and no later pick replaced it. */
    pick: (file: File) => Promise<boolean>
    remove: () => void
}

/** The file a reader chose, checked as it comes in. A refused file is never kept. */
export function useTestsetFilePick(): TestsetFilePick {
    const [state, setState] = useState<Omit<TestsetFilePick, "pick" | "remove">>({
        file: null,
        fileType: null,
        rows: [],
        totalRows: 0,
        error: null,
    })
    // A later pick or a remove makes an earlier, slower check stale.
    const latest = useRef(0)

    const pick = useCallback(async (file: File): Promise<boolean> => {
        const ticket = ++latest.current
        const check = await checkTestsetFile(file)
        if (ticket !== latest.current) return false
        setState(
            check.ok
                ? {
                      file,
                      fileType: check.fileType,
                      rows: check.rows,
                      totalRows: check.totalRows,
                      error: null,
                  }
                : {file: null, fileType: null, rows: [], totalRows: 0, error: check.message},
        )
        return check.ok
    }, [])

    const remove = useCallback(() => {
        latest.current += 1
        setState({file: null, fileType: null, rows: [], totalRows: 0, error: null})
    }, [])

    return {...state, pick, remove}
}
