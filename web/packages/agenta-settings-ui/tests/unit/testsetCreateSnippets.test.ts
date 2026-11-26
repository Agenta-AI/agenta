import {describe, expect, it} from "vitest"

import {
    buildTestsetJsonSnippets,
    buildTestsetUploadSnippets,
} from "../../src/publish/snippets/testsetCreate"

const LANGS = ["python", "bash", "typescript"] as const
const API_URL = "https://example.test/api"

describe("test set create snippets", () => {
    it("Upload snippets post to the simple upload path with the file type", () => {
        const snippets = buildTestsetUploadSnippets({apiUrl: API_URL})
        for (const lang of LANGS) {
            expect(snippets[lang]).toContain(`${API_URL}/simple/testsets/upload`)
            expect(snippets[lang]).toContain("testset_name")
            expect(snippets[lang]).toMatch(/file_type['"]?[:=,]\s*['"]?csv/)
        }
    })

    it("JSON snippets post the example test set to the simple testsets path", () => {
        const snippets = buildTestsetJsonSnippets({apiUrl: API_URL})
        const example = {
            testset: {
                slug: "your-testset-slug",
                name: "your_testset_name",
                data: {
                    testcases: [
                        {data: {column1: "value1", column2: "value2"}},
                        {data: {column1: "value3", column2: "value4"}},
                    ],
                },
            },
        }
        for (const lang of LANGS) {
            expect(snippets[lang]).toContain(`${API_URL}/simple/testsets/`)
            expect(snippets[lang]).not.toContain("/simple/testsets/upload")
        }
        // The curl body is the example as JSON, so it parses back to the same object.
        const curlBody = snippets.bash.split("-d ")[1].trim().slice(1, -1)
        expect(JSON.parse(curlBody)).toEqual(example)
    })

    it("Every snippet sends the ApiKey authorization header", () => {
        for (const build of [buildTestsetUploadSnippets, buildTestsetJsonSnippets]) {
            for (const lang of LANGS) {
                expect(build({apiUrl: API_URL})[lang]).toContain("Authorization")
                expect(build({apiUrl: API_URL})[lang]).toContain("ApiKey YOUR_API_KEY")
                expect(build({apiUrl: API_URL, apiKey: "k-123"})[lang]).toContain("ApiKey k-123")
            }
        }
    })
})
