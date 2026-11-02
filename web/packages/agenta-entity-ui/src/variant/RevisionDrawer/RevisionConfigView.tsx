import {useMemo, useState, type ReactNode} from "react"

import {DrillInUIProvider, useDrillInUI} from "@agenta/ui/drill-in"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Segmented} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import PlaygroundConfigSection from "../../DrillInView/components/PlaygroundConfigSection"
import {defaultAdapter} from "../../DrillInView/components/PlaygroundConfigSection/adapters"
import {hasRenderableConfigSections} from "../../DrillInView/components/PlaygroundConfigSection/schemaData"
import type {ConfigViewMode} from "../../DrillInView/components/PlaygroundConfigSection/types"

import type {RevisionDrawerKind} from "./types"

const VIEW_MODES: {label: string; value: ConfigViewMode}[] = [
    {label: "Form", value: "form"},
    {label: "JSON", value: "json"},
    {label: "YAML", value: "yaml"},
]

/**
 * Gives the config section its two editor slots, so a host only passes props. Slots a host
 * already provides win.
 */
const EditorSlots = ({children}: {children: ReactNode}) => {
    const outer = useDrillInUI()
    const components = useMemo(
        () => ({
            ...outer,
            EditorProvider: outer.EditorProvider ?? EditorProvider,
            SharedEditor: outer.SharedEditor ?? SharedEditor,
        }),
        [outer],
    )
    return <DrillInUIProvider components={components}>{children}</DrillInUIProvider>
}

/** The revision's configuration as committed, read only, as a form, JSON or YAML. */
export const RevisionConfigView = ({
    revisionId,
    kind,
}: {
    revisionId: string
    kind: RevisionDrawerKind
}) => {
    const [viewMode, setViewMode] = useState<ConfigViewMode>(
        kind === "deployment" ? "json" : "form",
    )
    // The same data and the same test the config section uses: parameters, or a hook or code group.
    const config = useAtomValue(defaultAdapter.atoms.serverData(revisionId))
    if (!hasRenderableConfigSections(config)) {
        return (
            <p className="text-muted-foreground m-0 py-6 text-center text-sm">
                No parameters to display
            </p>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            <Segmented
                className="self-start"
                options={VIEW_MODES}
                value={viewMode}
                onChange={(value) => setViewMode(value as ConfigViewMode)}
            />
            <EditorSlots>
                <PlaygroundConfigSection
                    revisionId={revisionId}
                    viewMode={viewMode}
                    disabled
                    useServerData
                    stickyHeaderTop={0}
                />
            </EditorSlots>
        </div>
    )
}
