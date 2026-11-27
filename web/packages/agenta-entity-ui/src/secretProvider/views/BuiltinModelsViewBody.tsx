/** The built-in models as a view: the panel under the stack's "Agenta" title. */
import {useT} from "@agenta/i18n"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {BuiltinModelsPanel} from "./BuiltinModelsPanel"
import type {BuiltinModelsViewParams} from "./providerViews"

const BuiltinModelsViewBody = (_props: ViewProps<BuiltinModelsViewParams>) => {
    const t = useT(providerListCatalog)
    useViewTitle(t("entityUi.providerList.agenta"))
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            <BuiltinModelsPanel />
        </div>
    )
}

export default BuiltinModelsViewBody
