import {useT} from "@agenta/i18n"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {CollapseCaret} from "@agenta/ui/ui"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {useAdvancedPartRows} from "../sections/AdvancedPartRows"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {AdvancedViewParams} from "./advancedViews"

const AdvancedViewBody = ({target, nav}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const rows = useAdvancedPartRows(writer.schema, writer.agent, writer.revisionId)
    useViewTitle(t("entityUi.modelHarness.advanced"))

    // One bordered card, a row per part (F04 f9): a plain 14 px icon, the title and its summary,
    // and a triangle caret.
    return (
        <div className="px-4 py-3.5">
            <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
                {rows.map((row) => (
                    <button
                        key={row.key}
                        type="button"
                        data-testid={`advanced-part-${row.key}`}
                        disabled={!nav.push}
                        onClick={() => void nav.push?.(row.view, {}, target)}
                        className="flex w-full cursor-pointer items-center gap-2.5 border-0 border-t border-solid border-colorSplit bg-transparent py-2.5 pl-3 pr-4 text-left font-[inherit] transition-colors first:border-t-0 hover:bg-colorFillQuaternary"
                    >
                        <span className="flex shrink-0 text-colorTextSecondary [&_svg]:size-3.5">
                            {row.icon}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[13px] font-medium leading-5 text-colorText">
                                {row.title}
                            </span>
                            {row.summary ? (
                                <span className="truncate text-[12px] leading-4 text-colorTextSecondary">
                                    {row.summary}
                                </span>
                            ) : null}
                        </span>
                        <CollapseCaret className="text-colorTextSecondary" />
                    </button>
                ))}
            </div>
        </div>
    )
}

export default AdvancedViewBody
