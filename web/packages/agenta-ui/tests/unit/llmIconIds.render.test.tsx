// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import Bedrock from "../../src/icons/llm-icons/assets/Bedrock"
import Sagemaker from "../../src/icons/llm-icons/assets/Sagemaker"

afterEach(cleanup)

describe("logos with a gradient", () => {
    it.each([
        ["Bedrock", Bedrock],
        ["Sagemaker", Sagemaker],
    ])("%s: each copy points at its own gradient and clip", (_, Icon) => {
        const {container} = render(
            <>
                <Icon />
                <Icon />
            </>,
        )
        const svgs = [...container.querySelectorAll("svg")]
        const refs = svgs.map((svg) => {
            const gradient = svg.querySelector("linearGradient")?.id
            const clip = svg.querySelector("clipPath")?.id
            expect(svg.querySelector("g")?.getAttribute("clip-path")).toBe(`url(#${clip})`)
            expect(svg.querySelector(`[fill="url(#${gradient})"]`)).not.toBeNull()
            return gradient
        })
        expect(refs[0]).not.toBe(refs[1])
    })
})
