import {useT} from "@agenta/i18n"
import providerDrawerCatalog from "@agenta/i18n/catalogs/entityUi.providerDrawer"
import {useViewTitle, type ViewDef, type ViewProps} from "@agenta/ui/view-stack"

import {ProviderListBody} from "./ProviderListBody"
import {
    builtinModelsView,
    providerAddView,
    providerConnectionView,
    type ProviderListParams,
} from "./providerViews"

/** The list as a view: its rows open their views one level down. */
const ProviderListViewBody = ({target, nav}: ViewProps<ProviderListParams>) => {
    const t = useT(providerDrawerCatalog)
    useViewTitle(t("entityUi.providerDrawer.modelProviders"))
    // At depth 2 there is no level left, so a row's view takes the list's place.
    const openChild = <P,>(view: ViewDef<P>, params: P) =>
        void (nav.push ?? nav.replace)(view, params, target)
    return (
        <ProviderListBody
            onAdd={() => openChild(providerAddView, {})}
            onOpenBuiltin={() => openChild(builtinModelsView, {})}
            onOpenConnection={(connection) =>
                openChild(providerConnectionView, {
                    kind: connection.kind,
                    connectionId: connection.id,
                })
            }
        />
    )
}

export default ProviderListViewBody
