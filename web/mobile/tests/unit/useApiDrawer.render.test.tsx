// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {UseApiDrawer} from "@/features/endpoints/UseApiDrawer"
import type {AppRevisionRow} from "@/features/variants/useAppRevisions"

const {snippets, keys} = vi.hoisted(() => ({
    snippets: vi.fn(),
    keys: {createApiKey: vi.fn()},
}))

vi.mock("@/features/endpoints/useEndpointSnippets", () => ({
    useAppSnippets: (args: unknown) => {
        snippets(args)
        const code = {python: "py", typescript: "ts", bash: "curl"}
        return {invoke: code, fetchConfig: code, isPending: false, isError: false}
    },
}))
// The Fern keys client is the HTTP boundary: the real createApiKey runs on top of it.
vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<object>()),
    getKeysClient: () => keys,
}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("next/dynamic", () => ({
    default: () => (props: {code: string}) => createElement("pre", null, props.code),
}))
vi.mock("@agenta/entity-ui/variant", () => ({
    VariantDetailsWithStatus: ({variantName, revision}: {variantName: string; revision: number}) =>
        createElement("span", null, `${variantName} v${revision}`),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const row = (id: string, slug: string, version: number) =>
    ({
        revisionId: id,
        workflowId: "app-1",
        variantId: slug,
        variantName: slug,
        variantSlug: slug,
        version,
        model: "",
        message: null,
        createdAt: null,
        createdById: null,
    }) satisfies AppRevisionRow

describe("the Use API drawer", () => {
    let root: Root
    let host: HTMLDivElement
    const render = (props: Partial<Parameters<typeof UseApiDrawer>[0]>) => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() =>
            root.render(
                createElement(UseApiDrawer, {
                    workspaceId: "ws-1",
                    projectId: "proj-1",
                    appSlug: "capital-finder",
                    onClose: vi.fn(),
                    ...props,
                }),
            ),
        )
    }
    const lastArgs = () => snippets.mock.calls.at(-1)?.[0]
    const input = () =>
        document.querySelector<HTMLInputElement>("input[placeholder='Enter existing API key']")!

    beforeEach(() => {
        snippets.mockReset()
        keys.createApiKey.mockReset().mockResolvedValue("ak-new")
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        document.body.innerHTML = ""
    })

    it("on the Registry shows the code for the chosen variant version", () => {
        render({
            variants: {
                rows: [row("r5", "verbose", 5), row("r3", "default", 3)],
                initialRevisionId: "r3",
            },
        })
        expect(lastArgs()).toEqual({
            appSlug: "capital-finder",
            revisionId: "r3",
            target: {variant: {slug: "default", version: 3}},
            apiKey: "",
        })
        expect(document.body.textContent).toContain("Fetch Prompt/Config")
        expect(document.body.textContent).toContain("Invoke LLM")
    })

    it("on Deployments shows the code for the selected environment", () => {
        render({environment: {slug: "staging", revisionId: "r5"}})
        expect(lastArgs()).toMatchObject({revisionId: "r5", target: {environmentSlug: "staging"}})
        expect(document.querySelector("[aria-label=Variant]")).toBeNull()
    })

    it("Generate API Key mints a key for this workspace and project and puts it in the code", async () => {
        render({environment: {slug: "production", revisionId: "r5"}})
        const generate = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent === "Generate API Key",
        )!
        await act(async () => generate.click())
        expect(keys.createApiKey).toHaveBeenCalledWith({
            queryParams: {workspace_id: "ws-1", project_id: "proj-1"},
        })
        expect(input().value).toBe("ak-new")
        expect(lastArgs()).toMatchObject({apiKey: "ak-new"})
    })
})
