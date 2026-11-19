import {mkdirSync, readFileSync} from "node:fs"

import {test, type Page} from "@playwright/test"

import {readRecipes, requireEnv, type ScreenRecipe, type ScreenStep} from "./recipe"

const recipes = readRecipes().filter((r) => "route" in r) as unknown as ScreenRecipe[]
const out = process.env.OUT ?? ""
const authFile = `${out}/.auth.json`

// Screens run in order, share one signed-in state, and never run in parallel.
test.describe.configure({mode: "serial"})

function fillRoute(route: string): string {
    if (!/\{\w+\}/.test(route)) return route
    const ids = JSON.parse(readFileSync(requireEnv("IDS"), "utf8")) as Record<string, string>
    return route.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = ids[name]
        if (!value) throw new Error(`No seed id for {${name}}`)
        return value
    })
}

/** A step target is a visible text, or "role:name" for a role (for example "button:Save"). */
function locate(page: Page, target: string) {
    const [role, ...rest] = target.split(":")
    if (rest.length > 0 && /^[a-z]+$/.test(role)) {
        return page.getByRole(role as Parameters<Page["getByRole"]>[0], {name: rest.join(":")})
    }
    return page.getByText(target).first()
}

async function runStep(page: Page, step: ScreenStep) {
    if (step.click) await locate(page, step.click).click()
    else if (step.fill) await locate(page, step.fill).fill(step.value ?? "")
    else if (step.press) await page.keyboard.press(step.press)
    else if (step.wait !== undefined) {
        if (typeof step.wait === "number") await page.waitForTimeout(step.wait)
        else await locate(page, step.wait).waitFor()
    }
}

async function signIn(page: Page) {
    await page.goto(`${requireEnv("APP_URL")}/m/auth`, {waitUntil: "networkidle"})
    await page.getByPlaceholder("Enter your email address").fill(requireEnv("QA_EMAIL"))
    await page.getByRole("button", {name: "Continue"}).first().click()
    await page.getByLabel("Password").first().fill(requireEnv("QA_PASSWORD"))
    await page.keyboard.press("Enter")
    await page.waitForURL((url) => !url.pathname.startsWith("/m/auth"), {timeout: 60_000})
    await page.context().storageState({path: authFile})
}

test.describe("screen captures", () => {
    test.beforeAll(async ({browser}) => {
        mkdirSync(requireEnv("OUT"), {recursive: true})
        // A recipe list with no authenticated screen needs no login (for example the login page itself).
        if (recipes.every((r) => r.route.startsWith("/m/auth"))) return
        const context = await browser.newContext()
        const page = await context.newPage()
        try {
            await signIn(page)
        } finally {
            await page.close()
            await context.close()
        }
    })

    for (const recipe of recipes) {
        test(recipe.id, async ({browser}) => {
            const authenticated = !recipe.route.startsWith("/m/auth")
            const context = await browser.newContext({
                viewport: {width: recipe.width, height: recipe.height},
                colorScheme: recipe.theme,
                storageState: authenticated ? authFile : undefined,
            })
            const page = await context.newPage()
            try {
                await page.goto(requireEnv("APP_URL") + fillRoute(recipe.route), {
                    waitUntil: "networkidle",
                })
                for (const step of recipe.steps) await runStep(page, step)
                await page.evaluate(() => document.fonts.ready)
                const path = `${requireEnv("OUT")}/${recipe.id}.png`
                if (recipe.selector) await page.locator(recipe.selector).first().screenshot({path})
                else await page.screenshot({path, fullPage: true})
            } finally {
                await page.close()
                await context.close()
            }
        })
    }
})
