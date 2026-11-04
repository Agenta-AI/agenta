import {useEffect, useState, type ReactNode} from "react"

import {axios} from "@agenta/shared/api"
import type {Decorator} from "@storybook/nextjs"

/**
 * A made-up test set API for the playground test set stories: two test sets, their versions and
 * their rows. The test set list goes through `fetch` (the generated client), the rest through
 * axios. Both are put back when the story unmounts.
 */
export const CAPITALS = "0b9f6c1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"
export const CAPITALS_V2 = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
const CAPITALS_V1 = "5e0b1c2d-3949-4b5c-8d6e-9f0a1b2c3d4e"
const RIVERS = "3e2c9f40-4f50-4162-9d2e-3f4a5b6c7d8e"
const RIVERS_V1 = "8b3e4f50-6c7d-4e8f-a091-2c3d4e5f6071"

const row = (n: number, country: string, capital: string) => ({
    id: `a1b2c3d4-0000-4000-8000-00000000000${n}`,
    testset_id: CAPITALS,
    data: {country, capital},
})
export const CAPITAL_ROWS = [
    row(1, "France", "Paris"),
    row(2, "Italy", "Rome"),
    row(3, "Peru", "Lima"),
    row(4, "Japan", "Tokyo"),
    row(5, "Kenya", "Nairobi"),
]

const TESTSETS = [
    {id: CAPITALS, name: "Capitals", created_at: "2026-10-02T00:00:00Z"},
    {id: RIVERS, name: "Rivers", created_at: "2026-10-01T00:00:00Z"},
]
const REVISIONS = [
    {id: CAPITALS_V2, testset_id: CAPITALS, version: "2", created_at: "2026-10-02T00:00:00Z"},
    {id: CAPITALS_V1, testset_id: CAPITALS, version: "1", created_at: "2026-10-01T00:00:00Z"},
    {id: RIVERS_V1, testset_id: RIVERS, version: "1", created_at: "2026-10-01T00:00:00Z"},
]

const answer = (url: string, body: Record<string, unknown>): unknown => {
    if (url.includes("/testsets/revisions/query")) {
        const refs = (body.testset_refs ?? []) as {id: string}[]
        const byId = (body.testset_revision_refs ?? []) as {id: string}[]
        const testset_revisions = REVISIONS.filter(
            (item) =>
                refs.some((ref) => ref.id === item.testset_id) ||
                byId.some((ref) => ref.id === item.id),
        )
        return {count: testset_revisions.length, testset_revisions}
    }
    if (url.includes("/testcases/query")) {
        const ref = (body.testset_revision_ref as {id: string} | undefined)?.id
        const testcases = ref === CAPITALS_V2 ? CAPITAL_ROWS : []
        return {count: testcases.length, testcases, windowing: {next: null}}
    }
    return {}
}

const install = () => {
    const previousAdapter = axios.defaults.adapter
    const previousFetch = window.fetch
    axios.defaults.adapter = async (config) => ({
        data: answer(
            config.url ?? "",
            typeof config.data === "string" ? JSON.parse(config.data) : (config.data ?? {}),
        ),
        status: 200,
        statusText: "OK",
        headers: {},
        config,
    })
    window.fetch = async (input, init) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (url.includes("/testsets/query")) {
            return new Response(JSON.stringify({count: TESTSETS.length, testsets: TESTSETS}), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            })
        }
        return previousFetch(input, init)
    }
    return () => {
        axios.defaults.adapter = previousAdapter
        window.fetch = previousFetch
    }
}

const StubbedApi = ({children}: {children: ReactNode}) => {
    // Installed before the first render, so the first requests already reach the stub.
    const [restore] = useState(install)
    useEffect(() => restore, [restore])
    return <>{children}</>
}

export const withTestsetApi: Decorator = (Story) => (
    <StubbedApi>
        <Story />
    </StubbedApi>
)
