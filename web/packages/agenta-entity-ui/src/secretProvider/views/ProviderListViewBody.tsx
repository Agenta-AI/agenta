import {useEffect} from "react"

import {useT} from "@agenta/i18n"
import providerDrawerCatalog from "@agenta/i18n/catalogs/entityUi.providerDrawer"
import {
    useOptionalViewStack,
    useViewTitle,
    type ViewDef,
    type ViewProps,
} from "@agenta/ui/view-stack"
import {useStore} from "jotai"

import {ProviderListBody} from "./ProviderListBody"
import {providerSaveFollowUpAtom} from "./providerSaveFollowUp"
import {
    builtinModelsView,
    providerAddView,
    providerConnectionView,
    type ProviderListViewParams,
} from "./providerViews"
import {subscriptionViewOf} from "./subscriptionViews"

/** The list as a view: its rows open their views one level down. */
const ProviderListViewBody = ({target, nav}: ViewProps<ProviderListViewParams>) => {
    const t = useT(providerDrawerCatalog)
    useViewTitle(t("entityUi.providerDrawer.modelProviders"))
    // Leaving Model providers without a save: a model picker's follow-up for this stack is stale.
    const store = useStore()
    const stackOpen = useOptionalViewStack()?.open
    useEffect(
        () => () => {
            if (store.get(providerSaveFollowUpAtom)?.host === stackOpen)
                store.set(providerSaveFollowUpAtom, null)
        },
        [store, stackOpen],
    )
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
            onOpenSubscription={(connection) => {
                const {view, params} = subscriptionViewOf(connection)
                openChild(view, params)
            }}
        />
    )
}

export default ProviderListViewBody
