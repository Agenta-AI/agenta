import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import settingsDeveloperViewsCatalog from "@agenta/i18n/catalogs/settings.developerViews"
import {
    PreferencesPage,
    usePreferenceBindings,
    type HostPreferenceItem,
    type ThemePickerProps,
} from "@agenta/settings-ui"
import {useThemeMode, useThemeOptions} from "@agenta/ui/theme"
import {useAtom} from "jotai"

import {developerViewPreviewSwitchesAtom} from "@/features/developer/developerViewAccess"

/** The text of each developer view that has a Preferences switch; the view id is not translated. */
const VIEW_TEXT = {
    "archived-apps": ["archivedApps", "archivedAppsDescription"],
    endpoints: ["endpoints", "endpointsDescription"],
    playground: ["playground", "playgroundDescription"],
    "evaluator-playground": ["evaluatorPlayground", "evaluatorPlaygroundDescription"],
    evaluations: ["evaluations", "evaluationsDescription"],
    "observability-app-filter": ["observabilityAppFilter", "observabilityAppFilterDescription"],
    "annotation-queues": ["annotationQueues", "annotationQueuesDescription"],
    testsets: ["testsets", "testsetsDescription"],
    variants: ["variants", "variantsDescription"],
    prompts: ["prompts", "promptsDescription"],
    evaluators: ["evaluators", "evaluatorsDescription"],
    "app-overview": ["appOverview", "appOverviewDescription"],
    "observability-actions": ["observabilityActions", "observabilityActionsDescription"],
} as const

/** Mobile binding for the shared preferences page. Developer views in preview add one switch each. */
export const PreferencesTab = () => {
    const t = useT(settingsDeveloperViewsCatalog)
    const {themeMode, setMode} = useThemeMode()
    const themeOptions = useThemeOptions()
    const theme = useMemo<ThemePickerProps>(
        () => ({
            options: themeOptions,
            mode: themeMode,
            onSelect: (mode) => setMode(mode as typeof themeMode),
        }),
        [themeMode, setMode, themeOptions],
    )
    const bindings = usePreferenceBindings()

    const [previewSwitches, setPreviewSwitch] = useAtom(developerViewPreviewSwitchesAtom)
    const hostItems = useMemo<HostPreferenceItem[]>(
        () =>
            previewSwitches.map(({view, optedIn}) => {
                const text = VIEW_TEXT[view.id as keyof typeof VIEW_TEXT]
                return {
                    section: "feature-flags",
                    key: `developer-view:${view.id}`,
                    // A view this file has no text for shows its own English.
                    title: text ? t(`settings.developerViews.${text[0]}`) : view.label,
                    description: text ? t(`settings.developerViews.${text[1]}`) : view.description,
                    binding: {
                        enabled: optedIn,
                        onChange: (next) => setPreviewSwitch({viewId: view.id, optedIn: next}),
                    },
                }
            }),
        [previewSwitches, setPreviewSwitch, t],
    )

    return (
        <PreferencesPage theme={theme} showLanguage bindings={bindings} hostItems={hostItems} />
    )
}
