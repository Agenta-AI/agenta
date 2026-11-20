/**
 * The changes of an approval card for an agent change: one block per change, with its title, its
 * path and the detail (a text diff, an old and a new value, or an added or removed item). Old
 * values come from the server preview; without one the card shows the proposed values and says so.
 */
import {useT} from "@agenta/i18n"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"

import type {ApprovalChange, ApprovalChangeDetail} from "../skin/types"

/** Lines a text detail shows before it scrolls inside its box. */
const TEXT_BOX =
    "m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-colorFillQuaternary px-2 py-1.5 font-mono text-[11px] leading-relaxed"

const diffLineClass = (line: string): string =>
    line.startsWith("+")
        ? "text-colorSuccess"
        : line.startsWith("-")
          ? "text-colorError"
          : "text-colorTextSecondary"

/** The hunks of a unified diff: the file header lines before the first `@@` go. A `---` or `+++`
 * inside a hunk is a changed line (a Markdown rule, a line that starts with `++`) and stays. */
const diffHunkLines = (diff: string): string[] => {
    const lines = diff.split("\n")
    const start = lines.findIndex((line) => line.startsWith("@@"))
    return start === -1 ? lines : lines.slice(start)
}

const TextDiff = ({detail}: {detail: Extract<ApprovalChangeDetail, {kind: "text_diff"}>}) => {
    if (detail.diff) {
        return (
            <pre className={TEXT_BOX} data-testid="change-diff">
                {diffHunkLines(detail.diff).map((line, index) => (
                    <span key={index} className={`block ${diffLineClass(line)}`}>
                        {line || " "}
                    </span>
                ))}
            </pre>
        )
    }
    const edits = detail.edits ?? []
    return (
        <div className="flex flex-col gap-1">
            {detail.old !== undefined ? (
                <pre
                    className={`${TEXT_BOX} text-colorError line-through`}
                    data-testid="change-old"
                >
                    {detail.old}
                </pre>
            ) : null}
            {detail.new !== undefined ? (
                <pre className={`${TEXT_BOX} text-colorSuccess`} data-testid="change-new">
                    {detail.new}
                </pre>
            ) : null}
            {edits.map((edit, index) => (
                <div key={index} className="flex flex-col gap-1">
                    {edit.old !== undefined ? (
                        <pre className={`${TEXT_BOX} text-colorError line-through`}>{edit.old}</pre>
                    ) : null}
                    {edit.new !== undefined ? (
                        <pre className={`${TEXT_BOX} text-colorSuccess`}>{edit.new}</pre>
                    ) : null}
                </div>
            ))}
        </div>
    )
}

const Detail = ({detail}: {detail: ApprovalChangeDetail}) => {
    switch (detail.kind) {
        case "text_diff":
            return <TextDiff detail={detail} />
        case "value_change":
            return (
                <span className="flex min-w-0 flex-wrap items-baseline gap-1.5 text-xs">
                    {detail.old !== undefined ? (
                        <>
                            <span
                                className="whitespace-pre-wrap break-all text-colorTextTertiary line-through"
                                data-testid="change-old"
                            >
                                {detail.old}
                            </span>
                            {detail.new !== undefined ? (
                                <span aria-hidden className="text-colorTextTertiary">
                                    →
                                </span>
                            ) : null}
                        </>
                    ) : null}
                    {detail.new !== undefined ? (
                        <span
                            className="whitespace-pre-wrap break-all font-medium text-colorText"
                            data-testid="change-new"
                        >
                            {detail.new}
                        </span>
                    ) : null}
                </span>
            )
        case "item":
            return (
                <span
                    className={`text-xs font-medium ${
                        detail.change === "added"
                            ? "text-colorSuccess"
                            : "text-colorError line-through"
                    }`}
                    data-testid={`change-item-${detail.change}`}
                >
                    <span aria-hidden>{detail.change === "added" ? "+ " : "− "}</span>
                    {detail.name}
                </span>
            )
        default:
            return null
    }
}

export const ChangeSections = ({
    changes,
    proposedValues,
    cannotApply,
}: {
    changes: ApprovalChange[]
    proposedValues?: boolean
    cannotApply?: boolean
}) => {
    const t = useT(chatChangeCardCatalog)
    return (
        <div
            className="flex max-h-[280px] flex-col gap-2 overflow-y-auto"
            data-testid="change-sections"
        >
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
            {changes.map((change, index) => {
                const path = change.path.join(" › ")
                return (
                    <div
                        key={`${path}-${index}`}
                        className={`flex min-w-0 flex-col gap-1 rounded-md border border-solid px-3 py-2 ${
                            change.fails ? "border-colorError" : "border-colorBorderSecondary"
                        }`}
                        data-fails={change.fails ? "true" : undefined}
                    >
                        <span className="text-xs font-medium text-colorText">{change.title}</span>
                        {path ? (
                            <span
                                className="truncate text-[11px] text-colorTextTertiary"
                                title={path}
                            >
                                {path}
                            </span>
                        ) : null}
                        {change.detail ? <Detail detail={change.detail} /> : null}
                    </div>
                )
            })}
        </div>
    )
}
