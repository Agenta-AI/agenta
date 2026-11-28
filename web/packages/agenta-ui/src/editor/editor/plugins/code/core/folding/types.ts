export interface FoldingLineInfo {
    key: string
    top: number
    height: number
    collapsed: boolean
    foldable: boolean
}

export interface CodeFoldingCoreOutput {
    getLines: () => FoldingLineInfo[]
    subscribe: (listener: () => void) => () => void
    toggleLineByKey: (lineKey: string) => void
    setLines: (lines: FoldingLineInfo[]) => void
}
