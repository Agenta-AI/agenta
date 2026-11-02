import {act, createElement} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {fetchMountFileBlob, axiosGet} = vi.hoisted(() => ({
    fetchMountFileBlob: vi.fn(),
    axiosGet: vi.fn(),
}))

vi.mock("@agenta/entities/drive", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/drive")>()),
    fetchMountFileBlob,
}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    axios: {get: axiosGet},
}))

import {
    DriveFileSourceContext,
    useDriveFileBlob,
    type DriveFileSource,
} from "../../src/drive/driveFileSource"

const mount = {id: "mount-1"}
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let seen: {blob: Blob | null; isPending: boolean; failed: boolean}

const Probe = ({path, version}: {path: string; version: string | undefined}) => {
    seen = useDriveFileBlob(mount, path, version)
    return null
}

const store = createStore()

const render = async (
    props: {path: string; version: string | undefined},
    source: DriveFileSource | null = null,
) => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    DriveFileSourceContext.Provider,
                    {value: source},
                    createElement(Probe, props),
                ),
            ),
        )
    })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const text = (blob: Blob | null) =>
    new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(blob as Blob)
    })

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    store.set(projectIdAtom, "project-1")
    fetchMountFileBlob.mockReset()
    axiosGet.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("useDriveFileBlob", () => {
    it("returns a local file's bytes without a fetch", async () => {
        const file = new File(["local bytes"], "budget.xlsx")
        await render(
            {path: "budget.xlsx", version: undefined},
            new Map([["budget.xlsx", {objectUrl: "blob:local", file}]]),
        )
        expect(seen.isPending).toBe(false)
        expect(await text(seen.blob)).toBe("local bytes")
        expect(fetchMountFileBlob).not.toHaveBeenCalled()
        expect(axiosGet).not.toHaveBeenCalled()
    })

    it("fetches a remote attachment through the app client", async () => {
        axiosGet.mockResolvedValue({data: new Blob(["remote bytes"])})
        await render(
            {path: "deck.pptx", version: undefined},
            new Map([["deck.pptx", {objectUrl: "https://api.test/attachments/9"}]]),
        )
        expect(axiosGet).toHaveBeenCalledWith("https://api.test/attachments/9", {
            responseType: "blob",
            signal: expect.any(AbortSignal),
        })
        expect(await text(seen.blob)).toBe("remote bytes")
    })

    it("holds the mount fetch until the version is known", async () => {
        fetchMountFileBlob.mockResolvedValue(new Blob(["v1"]))
        await render({path: "reports/q3.xlsx", version: undefined})
        expect(seen).toEqual({blob: null, isPending: true, failed: false})
        expect(fetchMountFileBlob).not.toHaveBeenCalled()
    })

    it("refetches a mount file when its version changes, and only then", async () => {
        fetchMountFileBlob.mockResolvedValueOnce(new Blob(["v1"]))
        await render({path: "reports/q3.xlsx", version: "etag-1"})
        expect(await text(seen.blob)).toBe("v1")
        expect(fetchMountFileBlob).toHaveBeenCalledTimes(1)
        expect(fetchMountFileBlob.mock.calls[0][0]).toMatchObject({
            mountId: "mount-1",
            projectId: "project-1",
            path: "reports/q3.xlsx",
        })

        await render({path: "reports/q3.xlsx", version: "etag-1"})
        expect(fetchMountFileBlob).toHaveBeenCalledTimes(1)

        fetchMountFileBlob.mockResolvedValueOnce(new Blob(["v2"]))
        await render({path: "reports/q3.xlsx", version: "etag-2"})
        expect(fetchMountFileBlob).toHaveBeenCalledTimes(2)
        expect(await text(seen.blob)).toBe("v2")
    })

    it("fails when the mount download fails", async () => {
        fetchMountFileBlob.mockResolvedValue(null)
        await render({path: "gone.xlsx", version: "s10"})
        expect(seen).toEqual({blob: null, isPending: false, failed: true})
    })
})
