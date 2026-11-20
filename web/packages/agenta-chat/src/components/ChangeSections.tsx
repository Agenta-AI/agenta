/**
 * The body of a change card (task 25.1): a header with the change's icon, title and path, then
 * its detail in one of four forms (a text diff, old and new values, an added or a removed item)
 * and its warning lines. Changes with the same title and path (the model and its reasoning) share
 * one header. Old values come from the server preview; without one the card shows the proposed
 * values and says so. The footer (the version note and the buttons) is the card's.
 */
import {useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"
import {computeTextDiffLines} from "@agenta/ui/diff"
import {
    ArrowRight,
    BookOpen,
    Cpu,
    FileText,
    GearSix,
    Plugs,
    Plus,
    ShieldCheck,
    Sparkle,
    SquaresFour,
    Warning,
    Wrench,
    X,
    type Icon,
} from "@phosphor-icons/react"

import type {
    ApprovalChange,
    ApprovalChangeDetail,
    ApprovalChangeRiskLine,
    ApprovalChangeSection,
} from "../skin/types"

const SECTION_ICON: Record<ApprovalChangeSection, Icon> = {
    instructions: FileText,
    model: Cpu,
    skills: BookOpen,
    mcps: Plugs,
    integrations: SquaresFour,
    tools: Wrench,
    permissions: ShieldCheck,
    settings: GearSix,
}

/** Diff rows before "View full diff" takes over. */
const INLINE_DIFF_LINES = 6

const ADD_ROW = "bg-[color-mix(in_srgb,var(--ag-colorSuccess)_13%,transparent)] text-colorSuccess"
const DEL_ROW = "bg-[color-mix(in_srgb,var(--ag-colorError)_10%,transparent)] text-colorError"

/** One block of the card: the changes that share a title and a path. */
export interface ChangeBlock {
    title: string
    path: string[]
    section: ApprovalChangeSection
    changes: ApprovalChange[]
    risks: ApprovalChangeRiskLine[]
    fails: boolean
}

/** Groups neighbouring changes with the same title and path, so they share one header. */
export const groupChanges = (changes: ApprovalChange[]): ChangeBlock[] => {
    const blocks: ChangeBlock[] = []
    for (const change of changes) {
        const last = blocks[blocks.length - 1]
        const same =
            last &&
            last.title === change.title &&
            last.path.join("\u0000") === change.path.join("\u0000")
        const block = same
            ? last
            : {
                  title: change.title,
                  path: change.path,
                  section: change.section,
                  changes: [],
                  risks: [],
                  fails: false,
              }
        if (!same) blocks.push(block)
        block.changes.push(change)
        block.fails ||= Boolean(change.fails)
        for (const risk of change.risks) {
            if (!block.risks.some((known) => known.message === risk.message)) block.risks.push(risk)
        }
    }
    return blocks
}

interface DiffRow {
    type: "context" | "added" | "removed" | "fold"
    content: string
}

/** The hunks of a unified diff: the file header lines before the first `@@` go. A `---` or `+++`
 * inside a hunk is a changed line (a Markdown rule, a line that starts with `++`) and stays. */
const unifiedRows = (diff: string): DiffRow[] => {
    const lines = diff.split("\n")
    const start = lines.findIndex((line) => line.startsWith("@@"))
    return (start === -1 ? lines : lines.slice(start)).map((line) =>
        line.startsWith("@@")
            ? {type: "fold", content: ""}
            : line.startsWith("+")
              ? {type: "added", content: line.slice(1)}
              : line.startsWith("-")
                ? {type: "removed", content: line.slice(1)}
                : {type: "context", content: line.startsWith(" ") ? line.slice(1) : line},
    )
}

const linesOf = (text: string | undefined, type: DiffRow["type"]): DiffRow[] =>
    text === undefined ? [] : text.split("\n").map((content) => ({type, content}))

/** The rows of a text detail: all of them, and the short form the card shows first. */
const diffRows = (
    detail: Extract<ApprovalChangeDetail, {kind: "text_diff"}>,
): {full: DiffRow[]; short: DiffRow[]} => {
    if (detail.diff) {
        const rows = unifiedRows(detail.diff)
        return {full: rows, short: rows}
    }
    // No preview: the proposed fragments, removed text then added text, with no context.
    if (detail.fragmentsOnly) {
        const rows = [
            ...(detail.edits ?? []).flatMap((edit) => [
                ...linesOf(edit.old, "removed"),
                ...linesOf(edit.new, "added"),
            ]),
            ...linesOf(detail.new, "added"),
        ]
        return {full: rows, short: rows}
    }
    const full = computeTextDiffLines(detail.old ?? "", detail.new ?? "") as DiffRow[]
    // Long unchanged runs fold to one row, with two lines of context around each change.
    const short = computeTextDiffLines(detail.old ?? "", detail.new ?? "", {
        enableFolding: true,
        contextLines: 2,
        foldThreshold: 3,
    }) as DiffRow[]
    return {full, short}
}

const DiffRows = ({rows}: {rows: DiffRow[]}) => (
    <>
        {rows.map((row, index) => (
            <div
                key={index}
                className={`flex px-2 ${
                    row.type === "added"
                        ? ADD_ROW
                        : row.type === "removed"
                          ? DEL_ROW
                          : "text-colorTextSecondary"
                }`}
            >
                <span aria-hidden className="mr-1.5 w-2.5 shrink-0 opacity-60">
                    {row.type === "added" ? "+" : row.type === "removed" ? "−" : " "}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">
                    {row.type === "fold" ? "⋯" : row.content || " "}
                </span>
            </div>
        ))}
    </>
)

const TextDiff = ({detail}: {detail: Extract<ApprovalChangeDetail, {kind: "text_diff"}>}) => {
    const t = useT(chatChangeCardCatalog)
    const [full, setFull] = useState(false)
    const rows = diffRows(detail)
    const shown = full ? rows.full : rows.short.slice(0, INLINE_DIFF_LINES)
    const more =
        !full && (rows.short.length > INLINE_DIFF_LINES || rows.full.length > rows.short.length)
    return (
        <div className="flex flex-col gap-1">
            <div
                className="max-h-80 overflow-auto rounded-md border border-solid border-colorBorderSecondary bg-colorFillQuaternary py-1 font-mono text-[11px] leading-[1.7]"
                data-testid="change-diff"
            >
                <DiffRows rows={shown} />
            </div>
            {more ? (
                <button
                    type="button"
                    onClick={() => setFull(true)}
                    className="cursor-pointer self-start border-0 bg-transparent p-0 text-xs text-colorTextSecondary hover:text-colorText"
                    data-testid="change-full-diff"
                >
                    {t("chat.changeCard.viewFullDiff", {count: rows.full.length})}
                </button>
            ) : null}
        </div>
    )
}

const ValueChange = ({detail}: {detail: Extract<ApprovalChangeDetail, {kind: "value_change"}>}) => (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        {detail.label ? <span className="text-colorTextSecondary">{detail.label}</span> : null}
        {detail.old !== undefined ? (
            <span
                className="whitespace-pre-wrap break-all font-mono text-colorError line-through"
                data-testid="change-old"
            >
                {detail.old}
            </span>
        ) : null}
        {detail.old !== undefined && detail.new !== undefined ? (
            <ArrowRight
                size={12}
                aria-hidden
                className="shrink-0 self-center text-colorTextTertiary"
            />
        ) : null}
        {detail.new !== undefined ? (
            <span
                className="whitespace-pre-wrap break-all font-mono text-colorSuccess"
                data-testid="change-new"
            >
                {detail.new}
            </span>
        ) : null}
    </div>
)

const Item = ({
    detail,
    section,
}: {
    detail: Extract<ApprovalChangeDetail, {kind: "item"}>
    section: ApprovalChangeSection
}) => {
    const t = useT(chatChangeCardCatalog)
    const added = detail.change === "added"
    const SectionIcon = SECTION_ICON[section]
    const note = added ? (detail.address ?? detail.description) : t("chat.changeCard.itemRemoved")
    return (
        <div className="flex min-w-0 flex-col gap-1" data-testid={`change-item-${detail.change}`}>
            <div className="flex min-w-0 items-center gap-2">
                <span
                    aria-hidden
                    className={`flex size-4 shrink-0 items-center justify-center rounded ${
                        added
                            ? "bg-colorSuccessBg text-colorSuccess"
                            : "bg-colorErrorBg text-colorError"
                    }`}
                >
                    {added ? <Plus size={11} weight="bold" /> : <X size={11} weight="bold" />}
                </span>
                <SectionIcon size={14} aria-hidden className="shrink-0 text-colorTextSecondary" />
                <span className="truncate text-[13px] font-medium text-colorText">
                    {detail.name}
                </span>
                {note ? (
                    <span
                        className="min-w-0 flex-1 truncate text-xs text-colorTextSecondary"
                        title={note}
                    >
                        {note}
                    </span>
                ) : null}
            </div>
            {added && detail.address && detail.description ? (
                <span className="pl-12 text-xs text-colorTextSecondary">{detail.description}</span>
            ) : null}
            {added && detail.files?.length ? (
                <div className="flex flex-col gap-0.5 pl-12 text-xs">
                    {detail.files.map((file) => (
                        <span key={file.path} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-mono text-colorText">{file.path}</span>
                            {file.executable ? (
                                <span className="text-colorTextSecondary">
                                    {t("chat.changeCard.canRun")}
                                </span>
                            ) : null}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

const Detail = ({
    detail,
    section,
}: {
    detail: ApprovalChangeDetail
    section: ApprovalChangeSection
}) => {
    switch (detail.kind) {
        case "text_diff":
            return <TextDiff detail={detail} />
        case "value_change":
            return <ValueChange detail={detail} />
        case "item":
            return <Item detail={detail} section={section} />
        default:
            return null
    }
}

/** The card header: the section's icon, the title and the path joined with "›". */
const ChangeHeader = ({
    icon: HeaderIcon,
    title,
    path,
    small = false,
}: {
    icon: Icon
    title: string
    path?: string[]
    small?: boolean
}) => {
    const joined = path?.join(" › ") ?? ""
    return (
        <div className="flex min-w-0 items-center gap-2.5">
            <span
                aria-hidden
                className={`flex shrink-0 items-center justify-center rounded-md bg-colorFillTertiary text-colorText ${
                    small ? "size-5" : "size-[26px]"
                }`}
            >
                <HeaderIcon size={small ? 12 : 14} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
                <span
                    className={`truncate font-semibold text-colorText ${small ? "text-xs" : "text-[13px]"}`}
                >
                    {title}
                </span>
                {joined ? (
                    <span
                        className="truncate text-xs text-colorTextSecondary"
                        title={joined}
                        data-testid="change-path"
                    >
                        {joined}
                    </span>
                ) : null}
            </div>
        </div>
    )
}

export const RiskLine = ({children}: {children: ReactNode}) => (
    <div
        role="note"
        className="flex items-start gap-2 rounded-lg bg-[var(--ag-colorWarningBg)] px-2.5 py-2 text-xs leading-4 text-[var(--ag-colorWarningText)]"
        data-testid="change-risk"
    >
        <Warning size={14} aria-hidden className="mt-px shrink-0" />
        <span>{children}</span>
    </div>
)

const Block = ({
    block,
    small,
    pathPrefix,
}: {
    block: ChangeBlock
    small: boolean
    pathPrefix: string[]
}) => (
    <div
        className={`flex min-w-0 flex-col gap-2 ${
            block.fails ? "rounded-md border border-solid border-colorError p-2" : ""
        }`}
        data-fails={block.fails ? "true" : undefined}
    >
        <ChangeHeader
            icon={SECTION_ICON[block.section]}
            title={block.title}
            path={[...pathPrefix, ...block.path]}
            small={small}
        />
        {block.changes.map((change, index) =>
            change.detail ? (
                <Detail key={index} detail={change.detail} section={change.section} />
            ) : null,
        )}
        {block.risks.map((risk) => (
            <RiskLine key={risk.message}>{risk.message}</RiskLine>
        ))}
    </div>
)

/** Whether the card's main button removes: every change of it takes an item away. */
export const removesOnly = (changes: ApprovalChange[]): boolean =>
    changes.length > 0 &&
    changes.every((change) => change.detail?.kind === "item" && change.detail.change === "removed")

export const ChangeSections = ({
    changes,
    proposedValues,
    cannotApply,
    agentName,
    header,
    sentence,
}: {
    changes: ApprovalChange[]
    proposedValues?: boolean
    cannotApply?: boolean
    /** The name of the agent the changes are for; the card always names it. */
    agentName?: string
    /** The card's own header (`create_agent`); the changes then show under it. */
    header?: {title: string; path: string[]}
    /** The sentence a card with its own header shows as its detail. */
    sentence?: string
}) => {
    const t = useT(chatChangeCardCatalog)
    const blocks = groupChanges(changes)
    // One block is the card: its header is the card's header, and its path starts with the agent.
    const single = !header && blocks.length === 1
    const cardHeader = header ? (
        <ChangeHeader icon={Sparkle} title={header.title} path={header.path} />
    ) : !single && blocks.length > 1 && agentName ? (
        <ChangeHeader
            icon={Sparkle}
            title={t("chat.changeCard.changesTo", {count: blocks.length, agent: agentName})}
        />
    ) : null
    return (
        <div className="flex min-w-0 flex-col gap-3" data-testid="change-sections">
            {cardHeader}
            {header && sentence ? (
                <p className="m-0 text-[13px] leading-relaxed text-colorTextSecondary">
                    {sentence}
                </p>
            ) : null}
            {proposedValues ? (
                <p className="m-0 text-xs text-colorTextSecondary" data-testid="change-proposed">
                    {t("chat.changeCard.proposedValues")}
                </p>
            ) : null}
            {cannotApply ? (
                <p className="m-0 text-xs text-colorError" data-testid="change-cannot-apply">
                    {t("chat.changeCard.cannotApply")}
                </p>
            ) : null}
            {blocks.length ? (
                <div className="flex max-h-[420px] min-w-0 flex-col gap-3 overflow-y-auto">
                    {blocks.map((block, index) => (
                        <Block
                            key={`${block.path.join("›")}-${index}`}
                            block={block}
                            small={!single}
                            pathPrefix={single && agentName ? [agentName] : []}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    )
}
