/**
 * @vitest-environment jsdom
 *
 * Tool rows in another language: the verbs and our own nouns are translated, while tool, file and
 * skill names stay as they are. English is pinned byte for byte in registry.test.ts.
 */
import {activeLanguageAtom, type Language} from "@agenta/i18n"
import {languageAtom, useLanguageSync} from "@agenta/i18n/language"
import {renderHook, waitFor} from "@testing-library/react"
import {getDefaultStore} from "jotai"
import {afterAll, beforeAll, describe, expect, it} from "vitest"

import {inSentence, resolveToolDisplay} from "../../../src/skin/registry"

const SKILL_PATH = "/tmp/agenta/mounts/p/m/agents/skills/5692802a/build-an-agent/SKILL.md"

const store = getDefaultStore()

/** Switches the language the way the app does, and waits until its catalogs have loaded. */
const switchLanguage = async (language: Language) => {
    store.set(languageAtom, language)
    const {unmount} = renderHook(() => useLanguageSync())
    await waitFor(() => expect(store.get(activeLanguageAtom)).toBe(language))
    unmount()
}

/** Runs a suite in one language and puts the previous language back after it. */
const inLanguage = (language: Language) => {
    let previous: {chosen: Language; active: Language}
    beforeAll(async () => {
        previous = {chosen: store.get(languageAtom), active: store.get(activeLanguageAtom)}
        await switchLanguage(language)
    })
    afterAll(() => {
        store.set(languageAtom, previous.chosen)
        store.set(activeLanguageAtom, previous.active)
    })
}

describe("tool activity in Japanese", () => {
    inLanguage("ja-JP")

    it("translates the built-in sentences and keeps the skill name", () => {
        const read = resolveToolDisplay("Read", {path: SKILL_PATH})
        expect(read.activity.done).toBe("ファイルを読み込みました")
        expect(read.verb?.done).toBe("読み込みました")
        expect(read.detail).toBe("build-an-agent スキル")
    })

    it("conjugates platform ops with the glossary term in the reader's language", () => {
        expect(resolveToolDisplay("mcp__agenta-tools__commit_revision").activity.done).toBe(
            "変更を保存しました",
        )
        expect(resolveToolDisplay("read_config").activity.done).toBe(
            "エージェントの設定を読み込みました",
        )
    })

    it("keeps a third-party app and noun as data", () => {
        expect(
            resolveToolDisplay("tools__composio__github__SEARCH_ISSUES__b81", undefined, "GitHub")
                .activity.done,
        ).toBe("GitHub issuesを検索しました")
    })

    it("keeps the app's capital when the object opens the approval text", () => {
        const display = resolveToolDisplay(
            "tools__composio__github__SEARCH_ISSUES__b81",
            undefined,
            "GitHub",
        )
        expect(inSentence(display.activity.running)).toBe("GitHub issuesを検索中")
    })
})

describe("tool activity in German", () => {
    inLanguage("de-DE")

    it("puts the preposition of a search before its object in both tenses", () => {
        const discover = resolveToolDisplay("discover_triggers")
        expect(discover.activity.running).toBe("Sucht nach triggers")
        expect(discover.activity.done).toBe("nach triggers gesucht")
        expect(discover.frame?.done.split("{{object}}")).toEqual(["nach ", " gesucht"])
    })

    it("frames a builtin search's detail the same way", () => {
        const grep = resolveToolDisplay("Grep", {pattern: "TODO"})
        expect(grep.frame?.running.split("{{object}}")).toEqual(["Sucht nach ", ""])
        expect(grep.frame?.done.split("{{object}}")).toEqual(["nach ", " gesucht"])
    })
})

describe("tool activity back in English", () => {
    inLanguage("en")

    it("reads as before", () => {
        expect(resolveToolDisplay("mcp__agenta-tools__commit_revision").activity.done).toBe(
            "Saved changes",
        )
        expect(resolveToolDisplay("Read", {path: SKILL_PATH}).detail).toBe("build-an-agent skill")
        expect(resolveToolDisplay("discover_triggers").activity.done).toBe("Searched for triggers")
    })

    it("lowers the leading verb for the approval text", () => {
        const display = resolveToolDisplay(
            "tools__composio__github__SEARCH_ISSUES__b81",
            undefined,
            "GitHub",
        )
        expect(inSentence(display.activity.running)).toBe("searching GitHub issues")
    })
})
