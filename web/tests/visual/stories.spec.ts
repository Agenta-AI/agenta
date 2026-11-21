import {mkdirSync} from "node:fs"

import {test} from "@playwright/test"

import {readRecipes, requireEnv, type StoryRecipe} from "./recipe"

const recipes = readRecipes().filter((r) => "story" in r) as unknown as StoryRecipe[]

test.describe("story captures", () => {
    test.beforeAll(() => mkdirSync(requireEnv("OUT"), {recursive: true}))

    for (const recipe of recipes) {
        test(recipe.id, async ({page}) => {
            await page.setViewportSize({width: recipe.width, height: recipe.height})
            const url = `${requireEnv("STORYBOOK_URL")}/iframe.html?id=${recipe.story}&globals=theme:${recipe.theme}&viewMode=story`
            // A Storybook dev server keeps its socket open, so "networkidle" never comes. Wait for
            // the story render to finish instead.
            await page.goto(url, {waitUntil: "load"})
            await page.waitForFunction(
                () =>
                    (
                        window as unknown as {
                            __STORYBOOK_PREVIEW__?: {currentRender?: {phase?: string}}
                        }
                    ).__STORYBOOK_PREVIEW__?.currentRender?.phase === "finished",
            )
            if (recipe.ready) await page.locator(recipe.ready).first().waitFor()
            await page.evaluate(() => document.fonts.ready)
            const path = `${requireEnv("OUT")}/${recipe.id}.png`
            if (recipe.selector) {
                await page.locator(recipe.selector).first().screenshot({path})
            } else {
                await page.screenshot({path})
            }
        })
    }
})
