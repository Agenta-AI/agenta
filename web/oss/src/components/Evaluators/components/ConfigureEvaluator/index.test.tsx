import {act} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {describe, expect, it, vi} from "vitest"

const {useLocalDraftWarning} = vi.hoisted(() => ({useLocalDraftWarning: vi.fn(() => false)}))

vi.mock("@agenta/playground-ui/hooks", () => ({useLocalDraftWarning}))
vi.mock("@agenta/playground-ui", () => ({}))
vi.mock("@agenta/entities/loadable", () => ({loadableController: {}}))
vi.mock("@agenta/entities/testcase", () => ({testcaseMolecule: {}}))
vi.mock("@agenta/ui", () => ({preloadEditorPlugins: async () => undefined, Tag: () => null}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@/oss/components/EditorViews/SimpleSharedEditor", () => ({default: () => null}))
vi.mock("@/oss/components/Playground/Components/PlaygroundTestcaseEditor", () => ({
    default: () => null,
}))
vi.mock("@/oss/components/SharedGenerationResultUtils", () => ({default: () => null}))
vi.mock("@/oss/components/Playground/OSSPlaygroundShell", () => ({
    OSSPlaygroundShell: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@/oss/state/url/playground", () => ({playgroundSyncAtom: atom(null)}))
vi.mock("./atoms", () => ({evaluatorConfigEntityIdsAtom: atom([])}))
vi.mock("./EvaluatorPlaygroundHeader", () => ({default: () => null}))
vi.mock("./SelectAppEmptyState", () => ({default: () => null}))
vi.mock("./useEvaluatorRunControls", () => ({
    useEvaluatorRunControls: () => ({
        appWorkflowAdapter: null,
        handleAppSelect: () => undefined,
        selectedAppLabel: null,
        runDisabled: false,
    }),
}))

import ConfigureEvaluatorPage from "./index"

describe("ConfigureEvaluatorPage", () => {
    it("asks before the page unloads with unsaved edits, like the app playground", () => {
        ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
        const root = createRoot(document.createElement("div"))

        act(() => {
            root.render(
                <Provider store={createStore()}>
                    <ConfigureEvaluatorPage />
                </Provider>,
            )
        })

        expect(useLocalDraftWarning).toHaveBeenCalled()
        act(() => root.unmount())
    })
})
