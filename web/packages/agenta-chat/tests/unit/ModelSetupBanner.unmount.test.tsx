/**
 * @vitest-environment jsdom
 *
 * A hidden model setup strip leaves no box in the page: it mounts only while the model needs
 * setup (and for its leave).
 */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

const setup = vi.hoisted(() => ({blocked: false, canFix: true}))
vi.mock("../../src/hooks/useAgentModelSetup", () => ({useAgentModelSetup: () => setup}))

import {ModelSetupBanner} from "../../src/components/ModelSetupBanner"

afterEach(cleanup)

describe("the model setup strip", () => {
    it("renders nothing while the model is ready", () => {
        setup.blocked = false
        const {container} = render(<ModelSetupBanner revisionId="rev" />)
        expect(container.innerHTML).toBe("")
    })

    it("shows while the model needs setup", async () => {
        setup.blocked = true
        render(<ModelSetupBanner revisionId="rev" />)
        expect(await screen.findByRole("status")).toBeTruthy()
    })
})
