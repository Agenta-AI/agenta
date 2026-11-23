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

    // One bordered card, a row per part (F04 f9): a plain 16 px icon, the title and its summary,
    // and a triangle caret.
    return (
        <div className="px-4 py-3.5">
            <div className="overflow-hidden rounded-lg border border-solid border-border-muted bg-background">
                {rows.map((row) => (
                    <button
                        key={row.key}
                        type="button"
                        data-testid={`advanced-part-${row.key}`}
                        disabled={!nav.push}
                        onClick={() => void nav.push?.(row.view, {}, target)}
                        // One height for every row, with or without a summary (SPACE-02).
                        className="box-border flex h-row-double w-full cursor-pointer items-center gap-2 border-0 border-t border-solid border-border-muted bg-transparent py-0 pl-3 pr-4 text-left font-[inherit] transition-colors first:border-t-0 hover:bg-accent"
                    >
                        <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">
                            {row.icon}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-label font-medium leading-5 text-foreground">
                                {row.title}
                            </span>
                            {row.summary ? (
                                <span className="truncate text-meta text-muted-foreground">
                                    {row.summary}
                                </span>
                            ) : null}
                        </span>
                        <CollapseCaret className="text-muted-foreground" />
                    </button>
                ))}
            </div>
        </div>
    )
}

export default AdvancedViewBody
