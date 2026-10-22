import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react"

import {downloadCsv} from "@agenta/shared/utils"
import {
    Button,
    cn,
    Dialog,
    DialogContent,
    DialogTitle,
    SimpleTooltip as Tooltip,
} from "@agenta/ui/ui"
import {ArrowsOutSimple, Check, Copy, DownloadSimple} from "@phosphor-icons/react"

import {
    cellKey,
    cellLayouts,
    tableModel,
    toCsv,
    toMarkdown,
    type CellLayout,
    type HastNode,
    type TableModel,
} from "./chatTableModel"

const LayoutContext = createContext<Map<string, CellLayout> | null>(null)
/** The frame scrolls sideways: its first column stays put. */
const PinnedContext = createContext(false)

const COPIED_MS = 1500

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const summaryOf = (model: TableModel) =>
    `${plural(model.rows.length, "row")} · ${plural(model.header.length, "column")}`

/** A horizontally scrolling box; its first column pins while the table is wider than it. */
const TableScroller = ({children}: {children: ReactNode}) => {
    const ref = useRef<HTMLDivElement>(null)
    const [overflowing, setOverflowing] = useState(false)
    useEffect(() => {
        const box = ref.current
        if (!box || typeof ResizeObserver === "undefined") return
        const measure = () => setOverflowing(box.scrollWidth > box.clientWidth + 1)
        const observer = new ResizeObserver(measure)
        observer.observe(box)
        // The table grows as rows stream in while the box keeps its width.
        if (box.firstElementChild) observer.observe(box.firstElementChild)
        measure()
        return () => observer.disconnect()
    }, [])
    return (
        <PinnedContext.Provider value={overflowing}>
            <div ref={ref} className="overflow-x-auto">
                {children}
            </div>
        </PinnedContext.Provider>
    )
}

const ToolbarButton = ({
    label,
    onClick,
    children,
}: {
    label: string
    onClick: () => void
    children: ReactNode
}) => (
    <Tooltip title={label}>
        <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onClick={onClick}
            className="size-[26px] rounded-md text-muted-foreground hover:text-foreground"
        >
            {children}
        </Button>
    </Tooltip>
)

const TABLE_CLASS =
    "w-full border-separate border-spacing-0 text-xs leading-5 sm:text-[13px] [&_thead]:bg-transparent [&_tbody_tr]:hover:bg-muted/40"

/** A markdown table in a frame: copy, download and expand sit in its header row; the body scrolls. */
export const ChatTable = ({node, children}: {node?: HastNode; children?: ReactNode}) => {
    const model = useMemo(
        () => (node ? tableModel(node) : {header: [], rows: [], columns: []}),
        [node],
    )
    const layouts = useMemo(() => (node ? cellLayouts(node, model) : null), [node, model])
    const [expanded, setExpanded] = useState(false)
    const [copied, setCopied] = useState(false)
    const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(
        () => () => {
            if (copiedTimer.current) clearTimeout(copiedTimer.current)
        },
        [],
    )

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(toMarkdown(model))
            setCopied(true)
            if (copiedTimer.current) clearTimeout(copiedTimer.current)
            copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS)
        } catch {
            setCopied(false)
        }
    }
    const summary = summaryOf(model)
    const table = <table className={TABLE_CLASS}>{children}</table>

    return (
        <LayoutContext.Provider value={layouts}>
            <div className="relative my-3 min-w-0 overflow-hidden rounded-lg border border-border/60 bg-background">
                {/* The actions ride the header row's right end; a fade keeps scrolled headers legible. */}
                <div className="absolute right-0 top-0 z-[2] flex h-[39px] items-center gap-0.5 bg-muted pl-4 pr-1.5 [mask-image:linear-gradient(to_right,transparent,black_12px)]">
                    <ToolbarButton label={copied ? "Copied" : "Copy as Markdown"} onClick={copy}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </ToolbarButton>
                    <ToolbarButton
                        label="Download CSV"
                        onClick={() => downloadCsv(toCsv(model), "table.csv")}
                    >
                        <DownloadSimple size={14} />
                    </ToolbarButton>
                    <ToolbarButton label="Expand" onClick={() => setExpanded(true)}>
                        <ArrowsOutSimple size={14} />
                    </ToolbarButton>
                </div>
                <TableScroller>{table}</TableScroller>
            </div>
            <Dialog open={expanded} onOpenChange={setExpanded}>
                <DialogContent className="max-w-6xl" aria-describedby={undefined}>
                    <DialogTitle className="pr-8 text-sm">{summary}</DialogTitle>
                    <div className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-background">
                        <TableScroller>{table}</TableScroller>
                    </div>
                </DialogContent>
            </Dialog>
        </LayoutContext.Provider>
    )
}

/** A header or body cell, laid out by its column: numbers right and unbroken, prose wrapping. */
export const ChatTableCell = ({
    as: Tag,
    node,
    style,
    children,
}: {
    as: "th" | "td"
    node?: HastNode
    style?: CSSProperties
    children?: ReactNode
}) => {
    const layouts = useContext(LayoutContext)
    const pinned = useContext(PinnedContext)
    const key = cellKey(node?.position)
    const layout = key ? layouts?.get(key) : undefined
    const header = Tag === "th"
    return (
        <Tag
            style={style}
            className={cn(
                "text-left",
                header
                    ? "h-10 whitespace-nowrap border-b border-border/60 bg-muted px-3.5 align-middle text-xs font-medium text-muted-foreground"
                    : "border-b border-border/40 px-3.5 py-3 align-top [tr:last-child>&]:border-b-0",
                layout?.numeric
                    ? "whitespace-nowrap text-right tabular-nums"
                    : layout?.prose
                      ? "min-w-48"
                      : "whitespace-nowrap",
                // The last header cell clears the actions; a right-aligned column keeps its edge.
                (header || layout?.numeric) && "[tr>&:last-child]:pr-28",
                layout?.first && !header && "font-medium",
                layout?.first &&
                    pinned &&
                    cn(
                        "sticky left-0 z-[1] border-r border-border/60",
                        header ? "bg-muted" : "bg-background",
                    ),
            )}
        >
            {children}
        </Tag>
    )
}
