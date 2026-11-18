/**
 * Tool rows in another language: the verbs and our own nouns are translated, while tool, file and
 * skill names stay as they are. English is pinned byte for byte in registry.test.ts.
 */
import {activeLanguageAtom} from "@agenta/i18n"
import {getDefaultStore} from "jotai"
import {beforeAll, describe, expect, it} from "vitest"

import {loadLanguage} from "../../../../agenta-i18n/src/registry"
import {resolveToolDisplay} from "../../../src/skin/registry"

const SKILL_PATH = "/tmp/agenta/mounts/p/m/agents/skills/5692802a/build-an-agent/SKILL.md"

describe("tool activity in Japanese", () => {
    beforeAll(async () => {
        await loadLanguage("ja-JP")
        getDefaultStore().set(activeLanguageAtom, "ja-JP")
    })

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
})

describe("tool activity back in English", () => {
    beforeAll(() => getDefaultStore().set(activeLanguageAtom, "en"))

    it("reads as before", () => {
        expect(resolveToolDisplay("mcp__agenta-tools__commit_revision").activity.done).toBe(
            "Saved changes",
        )
        expect(resolveToolDisplay("Read", {path: SKILL_PATH}).detail).toBe("build-an-agent skill")
    })
})
