import {useT} from "@agenta/i18n"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {useAdvancedPartRows} from "../sections/AdvancedPartRows"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {AdvancedViewParams} from "./advancedViews"

const AdvancedViewBody = ({target, nav}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const rows = useAdvancedPartRows(writer.schema, writer.agent, writer.revisionId)
    useViewTitle(t("entityUi.modelHarness.advanced"))

    // The Agent tab's section cards: muted, a white 28 px Mark, the summary and the triangle (CONS-02).
    return (
        <div className="flex flex-col gap-2 px-4 pt-3">
            {rows.map((row) => (
                <div key={row.key} data-testid={`advanced-part-${row.key}`}>
                    <ConfigAccordionSection
                        icon={row.icon}
                        title={row.title}
                        summary={row.summary}
                        onOpen={() => void nav.push?.(row.view, {}, target)}
                        drawerAffordance="triangle"
                        canvas="panel"
                        noDivider
                        iconTile
                    />
                </div>
            ))}
        </div>
    )
}

export default AdvancedViewBody
