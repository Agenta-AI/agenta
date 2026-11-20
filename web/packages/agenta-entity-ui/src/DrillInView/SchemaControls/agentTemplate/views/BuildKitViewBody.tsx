import {useT} from "@agenta/i18n"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {useAgentConfigWriter} from "../useAgentConfigWriter"
import {useBuildKit} from "../useBuildKit"

import type {AdvancedViewParams} from "./advancedViews"

/** Today's build kit body: the playground's own switch and tool list, applied at once. */
const BuildKitViewBody = ({target}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const {buildKitSection} = useBuildKit({
        revisionId: writer.revisionId,
        readOnly: writer.readOnly,
    })
    useViewTitle(t("entityUi.modelHarness.buildKit"))
    return <div className="flex min-h-0 flex-1 flex-col px-4 py-3">{buildKitSection}</div>
}

export default BuildKitViewBody
