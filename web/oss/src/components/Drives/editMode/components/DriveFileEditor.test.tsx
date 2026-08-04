import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterAll, afterEach, beforeAll, describe, expect, it} from "vitest"

import {driveEditBufferAtom, openEditBufferAtom} from "../state"

import {DriveFileEditor} from "./DriveFileEditor"

const reactActGlobal = globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}

beforeAll(() => {
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
    delete reactActGlobal.IS_REACT_ACT_ENVIRONMENT
})

describe("DriveFileEditor byte fidelity", () => {
    let root: Root | null = null
    let container: HTMLDivElement | null = null

    afterEach(() => {
        if (root) act(() => root?.unmount())
        container?.remove()
        root = null
        container = null
    })

    it.each([
        ["trailing newline", "first\nsecond\n"],
        ["trailing spaces", "first\nsecond  "],
        ["literal tab", "first\n\tsecond"],
        ["CRLF", "first\r\nsecond\r\n"],
        ["non-ASCII", "Grüße, 世界 🌍\n"],
        ["empty string", ""],
        ["compact JSON", '{"nested":{"value":1}}'],
    ])("round-trips %s through the real editor", async (_case, initialValue) => {
        const store = createStore()
        store.set(openEditBufferAtom, {
            bufferId: "buffer-a",
            driveKey: "drive-a",
            targetMountId: "mount-a",
            targetPath: "data.json",
            displayPath: "data.json",
            scope: "app",
            original: initialValue,
            baseMtime: 10,
            includeGitignored: false,
            supportsMarkdownPreview: false,
            language: "json",
        })
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)

        await act(async () => {
            root?.render(
                <Provider store={store}>
                    <DriveFileEditor driveKey="drive-a" />
                </Provider>,
            )
            await new Promise((resolve) => setTimeout(resolve, 0))
        })

        expect(store.get(driveEditBufferAtom)?.draft).toBe(initialValue)
    })
})
