/**
 * "Model providers" (F09 f1b): the catalog as Settings lists it. A picked row's form or sign-in
 * takes this view's place, so its Save goes back to the view that opened it.
 */
import {useCallback} from "react"

import {useT} from "@agenta/i18n"
import providerDrawerCatalog from "@agenta/i18n/catalogs/entityUi.providerDrawer"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {ProviderCatalogBody, type OpenProviderView} from "./ProviderCatalogBody"
import type {ProviderAddViewParams} from "./providerViews"

const ProviderAddViewBody = ({target, nav}: ViewProps<ProviderAddViewParams>) => {
    const t = useT(providerDrawerCatalog)
    useViewTitle(t("entityUi.providerDrawer.modelProviders"))
    const open = useCallback<OpenProviderView>(
        (view, params) => void nav.replace(view, params, target),
        [nav, target],
    )
    return <ProviderCatalogBody open={open} />
}

export default ProviderAddViewBody
