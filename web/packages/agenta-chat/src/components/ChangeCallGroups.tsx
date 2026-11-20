/**
 * The grouped change card (task 26.2): several change calls of one paused turn in one card. Each
 * call is one group "Saved together as v{base + 1}", because each call saves its own version (two
 * calls on one base can end in one save and one conflict). A group lists one row per change; a
 * row opens in place and shows the same detail as the single card. The other groups ("Needs you
 * first", "Applies at once") are section 46.
 */
import {useEffect, useState} from "react"

import {useT, type CatalogKey, type TranslationValues} from "@agenta/i18n"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"
import chatChangeCardStatesCatalog from "@agenta/i18n/catalogs/chat.changeCardStates"
import {useIsPhone} from "@agenta/ui/phone"
import {CaretRight, PencilSimple, Plus, Sparkle, X} from "@phosphor-icons/react"

import {useChangeVersions} from "../hooks/useChangeVersions"
import type {ApprovalPreview} from "../skin/types"

import {
    Block,
    blockLabel,
    diffRows,
    groupChanges,
    RiskLine,
    type ChangeBlock,
} from "./ChangeSections"
import {PhoneDetailScreen} from "./PhoneDetailScreen"

type Translate = (
    key: CatalogKey<typeof chatChangeCardStatesCatalog> | CatalogKey<typeof chatChangeCardCatalog>,
    values?: TranslationValues,
) => string

/** The short line a row shows beside its label: what the change does, in a few words. */
const blockSummary = (block: ChangeBlock, t: Translate): string | undefined => {
    const detail = block.changes.find((change) => change.detail)?.detail
    if (!detail) return undefined
    switch (detail.kind) {
        case "text_diff": {
            const rows = diffRows(detail).full
            const added = rows.filter((row) => row.type === "added").length
            const removed = rows.filter((row) => row.type === "removed").length
            const addedText = t("chat.changeCardStates.linesAdded", {count: added})
            if (added && removed)
                return t("chat.changeCardStates.linesAddedRemoved", {
                    added: addedText,
                    removed,
                })
            if (added) return addedText
            if (removed) return t("chat.changeCardStates.linesRemoved", {count: removed})
            return undefined
        }
        case "value_change":
            return detail.old !== undefined && detail.new !== undefined
                ? t("chat.changeCardStates.valueFromTo", {old: detail.old, new: detail.new})
                : detail.new
        case "item":
            if (detail.change === "removed") return t("chat.changeCard.itemRemoved")
            if (detail.files?.length)
                return t("chat.changeCardStates.filesCount", {count: detail.files.length})
            return detail.address ?? detail.description
        default:
            return undefined
    }
}

const blockMark = (block: ChangeBlock): "added" | "removed" | "changed" => {
    const detail = block.changes[0]?.detail
    return detail?.kind === "item" ? detail.change : "changed"
}

const Row = ({block}: {block: ChangeBlock}) => {
    const t = useT(chatChangeCardStatesCatalog, chatChangeCardCatalog)
    // On a phone a row opens its detail full screen (M05); on the desktop it opens in place.
    const phone = useIsPhone()
    const [open, setOpen] = useState(false)
    // A move across the phone width closes the row rather than turning one view into the other.
    useEffect(() => setOpen(false), [phone])
    const mark = blockMark(block)
    const label = blockLabel(block)
    const summary = blockSummary(block, t)
    return (
        <div className="flex min-w-0 flex-col" data-testid="change-block-row">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={phone ? undefined : open}
                className={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1 text-left hover:bg-colorFillQuaternary ${
                    phone ? "min-h-11" : "py-1.5"
                }`}
            >
                <CaretRight
                    size={11}
                    weight="bold"
                    aria-hidden
                    className={`shrink-0 text-colorTextTertiary transition-transform ${
                        open && !phone ? "rotate-90" : ""
                    }`}
                />
                <span
                    aria-hidden
                    className={`flex size-4 shrink-0 items-center justify-center rounded ${
                        mark === "added"
                            ? "bg-colorSuccessBg text-colorSuccess"
                            : mark === "removed"
                              ? "bg-colorErrorBg text-colorError"
                              : "bg-colorFillTertiary text-colorTextSecondary"
                    }`}
                >
                    {mark === "added" ? (
                        <Plus size={11} weight="bold" />
                    ) : mark === "removed" ? (
                        <X size={11} weight="bold" />
                    ) : (
                        <PencilSimple size={11} weight="bold" />
                    )}
                </span>
                <span className="shrink-0 truncate text-[13px] font-medium text-colorText">
                    {label}
                </span>
                {summary ? (
                    <span
                        className="min-w-0 flex-1 truncate text-xs text-colorTextSecondary"
                        title={summary}
                    >
                        {summary}
                    </span>
                ) : null}
            </button>
            {phone ? (
                <PhoneDetailScreen open={open} onOpenChange={setOpen} title={label}>
                    <Block block={block} small={false} pathPrefix={[]} />
                </PhoneDetailScreen>
            ) : null}
            {open && !phone ? (
                <div className="py-2 pl-6">
                    <Block block={block} small pathPrefix={[]} />
                </div>
            ) : (
                // A closed row still says its risk: "Approve all" never hides a warning line.
                block.risks.map((risk) => (
                    <div key={risk.message} className="pb-1 pl-6">
                        <RiskLine>{risk.message}</RiskLine>
                    </div>
                ))
            )}
        </div>
    )
}

/** One call: its version line, the conflict state before a click, and its rows. */
const CallGroup = ({preview, showAgent}: {preview: ApprovalPreview; showAgent: boolean}) => {
    const t = useT(chatChangeCardStatesCatalog)
    const tChange = useT(chatChangeCardCatalog)
    const {baseVersion, latestVersion} = useChangeVersions(preview.base)
    const conflict =
        baseVersion !== undefined && latestVersion !== undefined && latestVersion > baseVersion
    const blocks = groupChanges(preview.changes ?? [])
    return (
        <div className="flex min-w-0 flex-col gap-1" data-testid="change-call-group">
            {showAgent && preview.agentName ? (
                <span className="truncate text-xs font-semibold text-colorText">
                    {preview.agentName}
                </span>
            ) : null}
            {baseVersion !== undefined ? (
                <span className="text-xs font-medium text-colorTextSecondary">
                    {t("chat.changeCardStates.savedTogether", {version: baseVersion + 1})}
                </span>
            ) : null}
            {conflict ? (
                <div data-testid="change-conflict">
                    <RiskLine>
                        {tChange("chat.changeCard.conflict", {
                            latest: latestVersion,
                            base: baseVersion,
                        })}
                    </RiskLine>
                </div>
            ) : null}
            {preview.proposedValues ? (
                <p className="m-0 text-xs text-colorTextSecondary" data-testid="change-proposed">
                    {tChange("chat.changeCard.proposedValues")}
                </p>
            ) : null}
            {preview.cannotApply ? (
                <p className="m-0 text-xs text-colorError" data-testid="change-cannot-apply">
                    {tChange("chat.changeCard.cannotApply")}
                </p>
            ) : null}
            <div className="flex min-w-0 flex-col">
                {blocks.map((block, index) => (
                    <Row key={`${block.path.join("›")}-${index}`} block={block} />
                ))}
            </div>
        </div>
    )
}

/** The grouped card's header and groups; the footer (note and buttons) is the card's. */
export const ChangeCallGroups = ({previews}: {previews: ApprovalPreview[]}) => {
    const t = useT(chatChangeCardStatesCatalog)
    const tChange = useT(chatChangeCardCatalog)
    const count = previews.reduce(
        (sum, preview) => sum + groupChanges(preview.changes ?? []).length,
        0,
    )
    const agents = new Set(previews.map((preview) => preview.agentName))
    const agent = agents.size === 1 ? [...agents][0] : undefined
    const title = agent
        ? tChange("chat.changeCard.changesTo", {count, agent})
        : t("chat.changeCardStates.changesCount", {count})
    return (
        <div className="flex min-w-0 flex-col gap-3" data-testid="change-call-groups">
            <div className="flex min-w-0 items-center gap-2.5">
                <span
                    aria-hidden
                    className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-colorFillTertiary text-colorText"
                >
                    <Sparkle size={14} />
                </span>
                <span className="truncate text-[13px] font-semibold text-colorText">{title}</span>
            </div>
            {/* Up to 64 changes per call: the groups scroll, the footer stays. */}
            <div className="flex max-h-[420px] min-w-0 flex-col gap-3 overflow-y-auto">
                {previews.map((preview, index) => (
                    <CallGroup key={index} preview={preview} showAgent={!agent} />
                ))}
            </div>
        </div>
    )
}
