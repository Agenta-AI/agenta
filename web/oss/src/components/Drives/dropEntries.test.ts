import {beforeEach, describe, expect, it, vi} from "vitest"

import axios from "@/oss/lib/api/assets/axiosConfig"

import {uploadMountFile} from "./driveMedia"
import {
    collectDropEntry,
    type DropEntry,
    type DropEntryReader,
    readDroppedFiles,
} from "./dropEntries"

vi.mock("@/oss/lib/api/assets/axiosConfig", () => ({
    default: {post: vi.fn(), get: vi.fn()},
}))

vi.mock("@/oss/lib/helpers/api", () => ({
    getAgentaApiUrl: vi.fn(() => "https://api.example.test"),
}))

const file = (name: string) => new File([name], name, {type: "text/plain"})

/** A file entry whose `file()` resolves the given File. */
const fileEntry = (f: File): DropEntry => ({
    isFile: true,
    isDirectory: false,
    name: f.name,
    file: (onSuccess) => onSuccess(f),
})

/** A directory entry whose reader hands back `batches` in order, then an empty batch (the API's
 * end-of-list signal — a real reader returns at most ~100 entries per call). */
const dirEntry = (name: string, batches: DropEntry[][]): DropEntry => ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: (): DropEntryReader => {
        let next = 0
        return {
            readEntries: (onSuccess) => onSuccess(next < batches.length ? batches[next++] : []),
        }
    },
})

describe("collectDropEntry", () => {
    it("passes a plain file entry through with a bare relative path", async () => {
        const notes = file("notes.txt")
        await expect(collectDropEntry(fileEntry(notes))).resolves.toEqual([
            {file: notes, relativePath: "notes.txt"},
        ])
    })

    it("yields nothing for an empty directory", async () => {
        await expect(collectDropEntry(dirEntry("empty", []))).resolves.toEqual([])
    })

    it("flattens a directory tree, reading every batch the reader returns", async () => {
        const a = file("a.txt")
        const b = file("b.txt")
        const deep = file("deep.txt")
        const other = file("other.txt")
        const sub = dirEntry("sub", [[fileEntry(deep)]])
        // Two chunks: a real readEntries caps each call, so a single read would drop `sub` + other.txt.
        const root = dirEntry("myfolder", [
            [fileEntry(a), fileEntry(b)],
            [sub, fileEntry(other)],
        ])

        await expect(collectDropEntry(root)).resolves.toEqual([
            {file: a, relativePath: "myfolder/a.txt"},
            {file: b, relativePath: "myfolder/b.txt"},
            {file: deep, relativePath: "myfolder/sub/deep.txt"},
            {file: other, relativePath: "myfolder/other.txt"},
        ])
    })

    it("skips a file entry the browser refuses to read", async () => {
        const broken: DropEntry = {
            isFile: true,
            isDirectory: false,
            name: "gone.txt",
            file: (_onSuccess, onError) => onError?.(new Error("not found")),
        }
        await expect(collectDropEntry(dirEntry("d", [[broken]]))).resolves.toEqual([])
    })
})

describe("readDroppedFiles", () => {
    /** A DataTransfer stand-in: one item per (entry, file) pair, plus the flat `files` list. */
    const transfer = (pairs: {entry: DropEntry | null; file: File | null}[]) =>
        ({
            items: pairs.map(({entry, file}) => ({
                kind: "file",
                webkitGetAsEntry: () => entry,
                getAsFile: () => file,
            })),
            files: pairs.map((p) => p.file).filter(Boolean) as File[],
        }) as unknown as DataTransfer

    it("expands a dropped folder while passing a sibling file through", async () => {
        const inner = file("inner.txt")
        const loose = file("loose.txt")
        const folder = dirEntry("myfolder", [[fileEntry(inner)]])

        await expect(
            readDroppedFiles(
                transfer([
                    {entry: folder, file: new File([], "myfolder")},
                    {entry: fileEntry(loose), file: loose},
                ]),
            ),
        ).resolves.toEqual([
            {file: inner, relativePath: "myfolder/inner.txt"},
            {file: loose, relativePath: "loose.txt"},
        ])
    })

    it("falls back to the plain file when the item has no filesystem entry", async () => {
        const loose = file("loose.txt")
        await expect(readDroppedFiles(transfer([{entry: null, file: loose}]))).resolves.toEqual([
            {file: loose, relativePath: "loose.txt"},
        ])
    })
})

describe("uploadMountFile path composition", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(axios.post).mockResolvedValue({data: {}})
    })

    const postedPath = () => vi.mocked(axios.post).mock.calls[0]?.[2]?.params?.path

    it("nests a dropped folder's file under the destination folder", async () => {
        await uploadMountFile({
            mountId: "m1",
            destFolder: "reports",
            file: file("deep.txt"),
            destName: "myfolder/sub/deep.txt",
        })
        expect(postedPath()).toBe("reports/myfolder/sub/deep.txt")
    })

    it("keeps the relative path at the drive root", async () => {
        await uploadMountFile({
            mountId: "m1",
            destFolder: "",
            file: file("deep.txt"),
            destName: "myfolder/sub/deep.txt",
        })
        expect(postedPath()).toBe("myfolder/sub/deep.txt")
    })

    it("falls back to the filename when no destName is given", async () => {
        await uploadMountFile({mountId: "m1", destFolder: "reports", file: file("notes.txt")})
        expect(postedPath()).toBe("reports/notes.txt")
    })
})
