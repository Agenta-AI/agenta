/* eslint-disable import/order -- The hook now lives in `@agenta/chat/hooks`, and its import
   has to stay BELOW the `vi.mock` factories: hoisting otherwise pulls that module graph in
   ahead of them, and the workflow mock reads an import still in its TDZ. */
import {act} from "react"

import {draftConfigChangeSignalAtom} from "@agenta/shared/state"
import {atom, createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({write: vi.fn()}))
vi.mock("@agenta/entities/workflow", async (original) => {
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    const configuration = atom({
        agent: {
            harness: {kind: "pi_core", permissions: {deny: ["Write"]}},
            runner: {permissions: {default: "ask", rules: [{tool: "restricted", policy: "deny"}]}},
            sandbox: {kind: "daytona", permissions: {network: "off"}},
        },
    })
    const schema = atom(null)
    const candidates = atom({status: "loading", capabilities: null})
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {configuration: () => configuration, parametersSchema: () => schema},
            actions: {
                updateConfiguration: atom(null, (_get, _set, ...args: unknown[]) =>
                    fixture.write(...args),
                ),
            },
        },
        agentModelCandidatesAtomFamily: () => candidates,
    }
})
vi.mock("@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext", () => ({
    useOptionalOnboardingContext: () => null,
}))
vi.mock("../state/scope", () => ({useChatScopeKey: () => "test"}))
vi.mock("../state/sessions", () => {
    const add = atom(null, () => undefined)
    return {addSessionAtomFamily: () => add}
})

import {useChatSlashCommands} from "@agenta/chat/hooks"

it("pulses Permissions, not Advanced, and preserves explicit restrictions", async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    const store = createStore()
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    let commands: ReturnType<typeof useChatSlashCommands>
    function Host() {
        commands = useChatSlashCommands({entityId: "revision"})
        return null
    }
    try {
        await act(async () =>
            root.render(
                <Provider store={store}>
                    <Host />
                </Provider>,
            ),
        )
        await act(async () => commands.applyPermission("allow"))
        expect(store.get(draftConfigChangeSignalAtom)).toMatchObject({
            revisionId: "revision",
            sectionKeys: ["permissions"],
            origin: "slash-command",
        })
        expect(fixture.write).toHaveBeenCalledWith("revision", {
            agent: {
                harness: {kind: "pi_core", permissions: {deny: ["Write"]}},
                runner: {
                    permissions: {default: "allow", rules: [{tool: "restricted", policy: "deny"}]},
                },
                sandbox: {kind: "daytona", permissions: {network: "off"}},
            },
        })
    } finally {
        await act(async () => root.unmount())
        host.remove()
    }
})
