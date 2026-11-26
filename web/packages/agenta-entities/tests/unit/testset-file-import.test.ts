/**
 * Unit tests for the testset file import helpers.
 *
 * These helpers are pure: file type detection, CSV parsing, and the
 * preview reader that takes a File. No backend or Jotai store is needed.
 */

import {describe, it, expect} from "vitest"

import {detectTestsetFileType, parseCsvRows, readTestsetFilePreview} from "../../src/testset/core"

describe("Testset file import", () => {
    it("File type comes from the extension and ignores case", () => {
        expect(detectTestsetFileType("cases.csv")).toBe("csv")
        expect(detectTestsetFileType("CASES.CSV")).toBe("csv")
        expect(detectTestsetFileType("data.Json")).toBe("json")
    })

    it("A file with another extension has no type", () => {
        expect(detectTestsetFileType("notes.txt")).toBeNull()
        expect(detectTestsetFileType("archive.csv.zip")).toBeNull()
        expect(detectTestsetFileType("csv")).toBeNull()
    })

    it("CSV parse keeps commas and newlines inside quoted fields", () => {
        const rows = parseCsvRows('name,notes\r\n"Doe, Jane","line one\nline two"\r\n')
        expect(rows).toEqual([
            ["name", "notes"],
            ["Doe, Jane", "line one\nline two"],
        ])
    })

    it("CSV parse turns doubled quotes into one quote", () => {
        const rows = parseCsvRows('quote\n"She said ""hi"""\n')
        expect(rows).toEqual([["quote"], ['She said "hi"']])
    })

    it("CSV parse drops rows where every field is empty", () => {
        const rows = parseCsvRows("a,b\n,\n  ,  \nc,d\n")
        expect(rows).toEqual([
            ["a", "b"],
            ["c", "d"],
        ])
    })

    it("CSV preview maps the header row to keys and fills missing values with an empty string", async () => {
        const file = new File(["question,answer,tag\nWhat is 2+2?,4\n"], "cases.csv")
        const result = await readTestsetFilePreview(file, "csv")
        expect(result).toEqual({
            ok: true,
            rows: [{question: "What is 2+2?", answer: "4", tag: ""}],
            totalRows: 1,
        })
    })

    it("CSV preview stops at the row limit", async () => {
        const lines = ["id"]
        for (let index = 1; index <= 25; index += 1) {
            lines.push(String(index))
        }
        const file = new File([lines.join("\n")], "many.csv")
        const result = await readTestsetFilePreview(file, "csv", 10)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.rows).toHaveLength(10)
        expect(result.rows[0]).toEqual({id: "1"})
        expect(result.rows[9]).toEqual({id: "10"})
        expect(result.totalRows).toBe(25)
    })

    it("JSON preview counts every object row and skips other items", async () => {
        const items = [...Array.from({length: 12}, (_, index) => ({id: index})), "text", [1], null]
        const file = new File([JSON.stringify(items)], "many.json")
        const result = await readTestsetFilePreview(file, "json", 5)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.rows).toHaveLength(5)
        expect(result.totalRows).toBe(12)
    })

    it("Invalid JSON reports invalid-json", async () => {
        const file = new File(["{not json"], "broken.json")
        const result = await readTestsetFilePreview(file, "json")
        expect(result).toEqual({ok: false, reason: "invalid-json"})
    })

    it("A JSON object that is not an array is valid but has no preview rows", async () => {
        const file = new File(['{"question": "What is 2+2?"}'], "object.json")
        const result = await readTestsetFilePreview(file, "json")
        expect(result).toEqual({ok: true, rows: [], totalRows: 0})
    })
})

describe("CSV parse keeps field whitespace", () => {
    it("CSV parse keeps spaces inside fields but drops rows that are only spaces", () => {
        expect(parseCsvRows('prompt\n"  hello  "\n   \n')).toEqual([["prompt"], ["  hello  "]])
    })
})
