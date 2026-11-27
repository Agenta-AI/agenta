import type {ReactNode} from "react"

import type {ValueViewMode} from "@agenta/chat/value-view"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {Segmented, Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"

export type ScenarioFocusTab = "io" | "results" | "metadata"

/**
 * The drawer's tabs, "Inputs and output", "Results" and "Metadata", with the Formatted or Raw
 * switch beside them. The open tab's body scrolls on its own.
 */
export const ScenarioFocusTabs = ({
    tab,
    onTab,
    mode,
    onMode,
    children,
}: {
    tab: ScenarioFocusTab
    onTab: (next: ScenarioFocusTab) => void
    mode: ValueViewMode
    onMode: (next: ValueViewMode) => void
    /** The open tab's body. */
    children: ReactNode
}) => {
    const t = useT(focusCatalog, valueViewCatalog)
    const tabs: {value: ScenarioFocusTab; label: string}[] = [
        {value: "io", label: t("evaluations.scenarioFocus.tabInputsOutput")},
        {value: "results", label: t("evaluations.scenarioFocus.tabResults")},
        {value: "metadata", label: t("evaluations.scenarioFocus.tabMetadata")},
    ]
    return (
        <Tabs
            value={tab}
            onValueChange={(next) => onTab(next as ScenarioFocusTab)}
            className="min-h-0 flex-1 gap-0"
        >
            <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-border-muted px-4">
                <TabsList aria-label={t("evaluations.scenarioFocus.views")}>
                    {tabs.map(({value, label}) => (
                        <TabsTrigger key={value} value={value}>
                            {label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <Segmented
                    size="sm"
                    aria-label={t("evaluations.scenarioFocus.viewAs")}
                    options={[
                        {value: "formatted", label: t("chat.valueView.formatted")},
                        {value: "raw", label: t("chat.valueView.raw")},
                    ]}
                    value={mode}
                    onChange={(next) => onMode(next as ValueViewMode)}
                />
            </div>
            <TabsContent value={tab} className="min-h-0 flex-1 overflow-y-auto p-4">
                {children}
            </TabsContent>
        </Tabs>
    )
}
