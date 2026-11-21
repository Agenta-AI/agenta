/** A read folder is no drop target: the drag is not accepted there, so nothing is offered. */
import {act} from "react"

import {useDriveDrop, type DriveDrop} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

let container: HTMLDivElement
let root: Root
let drop: DriveDrop

const Probe = ({onUpload}: {onUpload: () => void}) => {
    drop = useDriveDrop({
        canDropAt: (folder) => !folder.startsWith("drives/prices"),
        onUpload,
        onNavigate: () => {},
    })
    return null
}

const fileDrag = () =>
    ({
        dataTransfer: {types: ["Files"]},
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    }) as unknown as React.DragEvent & {preventDefault: ReturnType<typeof vi.fn>}

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<Probe onUpload={vi.fn()} />))
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe("useDriveDrop canDropAt", () => {
    it("accepts a drag over a writable folder and refuses it over a read folder", () => {
        const ok = fileDrag()
        drop.folderDropProps("drives/team").onDragOver(ok)
        expect(ok.preventDefault).toHaveBeenCalled()

        const refused = fileDrag()
        drop.folderDropProps("drives/prices/2026").onDragOver(refused)
        expect(refused.preventDefault).not.toHaveBeenCalled()
        // Still kept from the container, which would take the drop into the open folder.
        expect(refused.stopPropagation).toHaveBeenCalled()

        const container = fileDrag()
        drop.containerDropProps("drives/prices").onDragOver(container)
        expect(container.preventDefault).not.toHaveBeenCalled()
    })

    it("does not highlight a read folder", () => {
        act(() => drop.folderDropProps("drives/prices").onDragEnter(fileDrag()))
        expect(drop.hoverPath).toBeNull()
        act(() => drop.folderDropProps("drives/team").onDragEnter(fileDrag()))
        expect(drop.hoverPath).toBe("drives/team")
    })
})
