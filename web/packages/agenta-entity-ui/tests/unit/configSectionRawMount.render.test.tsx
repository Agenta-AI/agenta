/**
 * The config section mounted straight into JSON or YAML (apps-deploy-07). The editor must get the
 * config on its first render: a read-only editor does not take a later value, so it stayed empty.
 */
import {act} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {mounts} = vi.hoisted(() => ({mounts: [] as {initialValue: string}[]}))

vi.mock("@agenta/ui/shared-editor", () => ({
    SharedEditor: ({initialValue}: {initialValue: string}) => {
        mounts.push({initialValue})
        return <div data-testid="raw-editor">{initialValue}</div>
    },
}))
vi.mock("../../src/DrillInView/components/MoleculeDrillInView", () => ({
    MoleculeDrillInView: () => null,
}))

import PlaygroundConfigSection from "../../src/DrillInView/components/PlaygroundConfigSection"
import type {ConfigViewMode} from "../../src/DrillInView/components/PlaygroundConfigSection/types"

const config = {parameters: {prompt: {messages: [{role: "user", content: "Hi"}]}}}
const constant = <T,>(value: T) => atom(value)
const adapter = {
    atoms: {
        data: () => constant(config),
        serverData: () => constant(config),
        draft: () => constant(null),
        isDirty: () => constant(false),
        schemaQuery: () => constant({isPending: false, data: null}),
        agConfigSchema: () => constant(null),
    },
    reducers: {update: atom(null, () => undefined), discard: atom(null, () => undefined)},
    selectors: {schemaAtPath: () => constant(null)},
    drillIn: {},
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    mounts.length = 0
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("PlaygroundConfigSection mounted in a raw view", () => {
    it.each(["json", "yaml"] as ConfigViewMode[])(
        "fills the %s editor on its first render, read only",
        async (viewMode) => {
            await act(async () => {
                root.render(
                    <Provider store={createStore()}>
                        <PlaygroundConfigSection
                            revisionId="rev-1"
                            viewMode={viewMode}
                            disabled
                            useServerData
                            moleculeAdapter={adapter as never}
                        />
                    </Provider>,
                )
            })
            expect(mounts.length).toBeGreaterThan(0)
            expect(mounts[0].initialValue).toContain("Hi")
            expect(host.textContent).toContain("Hi")
        },
    )
})
