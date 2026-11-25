/**
 * AI providers when the project's secrets fail to load: the list must say so and offer Try
 * again, not show an empty list as if the project had no providers.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ProviderListBody} from "../../src/secretProvider/views/ProviderListBody"

import {byText, click} from "./domHelpers"

const vault = vi.hoisted(() => ({isPending: false, isError: true, refetch: vi.fn()}))

vi.mock("@agenta/entities/secret", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
        providerConnectionsAtom: atom(() => []),
        vaultSecretsQueryAtom: atom(() => vault),
    }
})

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        builtinModelEndpointsQueryAtom: atom(() => ({data: undefined})),
    }
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("AI providers with a failed secrets read", {timeout: 30_000}, () => {
    it("shows the failure with Try again instead of an empty list", async () => {
        await act(async () =>
            root.render(
                <ProviderListBody
                    onAdd={() => undefined}
                    onOpenConnection={() => undefined}
                    onOpenSubscription={() => undefined}
                    onOpenBuiltin={() => undefined}
                />,
            ),
        )
        expect(byText("Agenta could not load the model providers.")).toBeTruthy()
        await click(byText("Try again", "button"))
        expect(vault.refetch).toHaveBeenCalled()
    })
})
