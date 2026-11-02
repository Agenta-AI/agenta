// @vitest-environment jsdom
/**
 * Add to testset: the rules the commit modal is given, the failure text, and the export toast.
 * The commit modal and the picker are stubs that record their props; the controllers are the
 * shared fake. No request is sent.
 */
import {act} from "react"

import {Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

interface ModalProps {
    open: boolean
    entity: {type: string; id: string; name: string}
    canSubmit: (params: {mode?: string}) => boolean
    onSubmit: (params: {
        mode?: string
        message?: string
        entityName?: string
        entitySlug?: string
    }) => Promise<{success: boolean; error?: string}>
    renderModeContent: (params: {mode?: string}) => React.ReactNode
    createEntityFields: {defaultName: (params: {entity: {name?: string}}) => string}
    submitLabel: string
    actionLabel: string
    successMessage: string | null
}

const fixture = vi.hoisted(() => ({
    modal: null as ModalProps | null,
    toast: {success: vi.fn(), error: vi.fn()},
    push: vi.fn(() => Promise.resolve(true)),
    testsetsEnabled: false as boolean | null,
}))

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
    }
})
vi.mock("@agenta/entity-ui/modals", () => ({
    EntityCommitModal: (props: ModalProps) => {
        fixture.modal = props
        return null
    },
}))
vi.mock("@agenta/entity-ui/selection", () => ({
    EntityPicker: ({placeholders}: {placeholders: string[]}) => <div>{placeholders[0]}</div>,
}))
vi.mock("@agenta/entities/testset", async () => {
    const {atom} = await import("jotai")
    return {testsetsListAtom: atom({data: [], isPending: false})}
})
vi.mock("@agenta/ui/app-message", () => ({message: fixture.toast}))
vi.mock("next/router", () => ({useRouter: () => ({push: fixture.push})}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => fixture.testsetsEnabled,
}))

import {AddToTestsetModal} from "@/features/annotations/AddToTestsetModal"
import {useAddToTestsetToast} from "@/features/annotations/useAddToTestsetToast"

import {
    callsOf,
    fakeStore,
    handlers,
    patchSession,
    resetSession,
} from "../support/annotationSessionFake"

let host: HTMLDivElement
let root: Root

const ToastHost = () => {
    useAddToTestsetToast("/w/ws-1/p/proj-1")
    return null
}

const render = async () => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <AddToTestsetModal queueId="queue-1" queueName="Support replies" />
                <ToastHost />
            </Provider>,
        ),
    )
}
const modal = () => {
    expect(fixture.modal).not.toBeNull()
    return fixture.modal as ModalProps
}

beforeEach(() => {
    vi.clearAllMocks()
    fixture.modal = null
    fixture.testsetsEnabled = false
    resetSession({isAddToTestsetModalOpen: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("add to testset", () => {
    it("Existing mode needs a picked testset before Add is enabled", async () => {
        await render()
        expect(modal().open).toBe(true)
        expect(modal().submitLabel).toBe("Add")
        expect(modal().actionLabel).toBe("Add to Testset")
        expect(modal().canSubmit({mode: "existing"})).toBe(false)

        await act(async () => patchSession({pendingTestsetSelection: "testset-1"}))
        expect(modal().canSubmit({mode: "existing"})).toBe(true)

        // Never while an export runs.
        await act(async () => patchSession({isAddToTestsetExporting: true}))
        expect(modal().canSubmit({mode: "existing"})).toBe(false)
        expect(modal().canSubmit({mode: "new"})).toBe(false)
    })

    it("New mode proposes the queue name", async () => {
        await render()
        expect(modal().canSubmit({mode: "new"})).toBe(true)
        expect(modal().entity.name).toBe("Support replies")
        expect(modal().createEntityFields.defaultName({entity: modal().entity})).toBe(
            "Support replies",
        )
        // The picker shows only for an existing testset.
        await act(async () => root.render(<>{modal().renderModeContent({mode: "existing"})}</>))
        expect(host.textContent).toContain("Select testset")
        expect(modal().renderModeContent({mode: "new"})).toBeNull()
    })

    it("A failed start shows Failed to start testset export", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        handlers.addScenariosToTestset = async () => {
            throw new Error("Request failed with status code 500")
        }
        await render()
        const result = await modal().onSubmit({
            mode: "new",
            entityName: "Replies",
            entitySlug: "replies",
        })
        expect(result).toEqual({success: false, error: "Failed to start testset export"})
        expect(callsOf("addScenariosToTestset")).toEqual([
            {
                targetMode: "new",
                commitMessage: "",
                newTestsetName: "Replies",
                newTestsetSlug: "replies",
            },
        ])
        // The modal itself says nothing about a commit: the export reports when it ends.
        expect(modal().successMessage).toBeNull()
        consoleError.mockRestore()
    })

    it("A finished export shows the toast once with the row count", async () => {
        await render()
        await act(async () =>
            patchSession({
                addToTestsetExportJob: {
                    id: "job-1",
                    status: "success",
                    total: 3,
                    processed: 3,
                    targetTestsetId: "testset-1",
                    targetTestsetName: "Regression set",
                },
            }),
        )
        expect(fixture.toast.success).toHaveBeenCalledTimes(1)
        expect(fixture.toast.success).toHaveBeenCalledWith(
            expect.objectContaining({content: "Added 3 rows to Regression set.", duration: 5}),
        )
        await act(async () => patchSession({isAddToTestsetModalOpen: false}))
        expect(fixture.toast.success).toHaveBeenCalledTimes(1)
    })

    it("The toast has no link while the testsets view is hidden", async () => {
        await render()
        const job = {id: "job-2", status: "success", total: 1, processed: 1, targetTestsetId: "t-9"}
        await act(async () => patchSession({addToTestsetExportJob: job}))
        const [hidden] = fixture.toast.success.mock.calls.at(-1) as [Record<string, unknown>]
        expect(hidden.content).toBe("Added 1 row to testset.")
        expect(hidden.onNavigate).toBeUndefined()
        expect(hidden.linkText).toBeUndefined()

        fixture.testsetsEnabled = true
        await act(async () => patchSession({addToTestsetExportJob: {...job, id: "job-3"}}))
        const [shown] = fixture.toast.success.mock.calls.at(-1) as [
            {onNavigate: () => void; linkText: string},
        ]
        expect(shown.linkText).toBe('View "testset"')
        shown.onNavigate()
        expect(fixture.push).toHaveBeenCalledWith("/w/ws-1/p/proj-1/testsets/t-9")
    })
})
