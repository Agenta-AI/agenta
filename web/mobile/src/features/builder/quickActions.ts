import type {CatalogKey} from "@agenta/i18n"
import type builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

type PanelKey = CatalogKey<typeof builderPanelCatalog>

/**
 * A ready request of a new chat in the panel: its title, the line under it and the request it
 * puts in the composer. The request names the agent of the panel as `{{agent}}`.
 */
export interface ReadyRequest {
    title: PanelKey
    line: PanelKey
    request: PanelKey
}

/** The ready requests of a new chat in the panel, in their order on screen. */
export const READY_REQUESTS: readonly ReadyRequest[] = [
    {
        title: "builder.panel.suggest",
        line: "builder.panel.suggestLine",
        request: "builder.panel.suggestRequest",
    },
    {
        title: "builder.panel.check",
        line: "builder.panel.checkLine",
        request: "builder.panel.checkRequest",
    },
    {
        title: "builder.panel.optimize",
        line: "builder.panel.optimizeLine",
        request: "builder.panel.optimizeRequest",
    },
    {
        title: "builder.panel.explain",
        line: "builder.panel.explainLine",
        request: "builder.panel.explainRequest",
    },
]
