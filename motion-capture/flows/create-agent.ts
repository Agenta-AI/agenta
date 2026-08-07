import { defineFlow } from "../scripts/lib/flow";

/**
 * Flow: create an agent from Agent Home.
 *
 * Path (from codebase exploration): the app root redirects to
 * /w/{ws}/p/{proj}/apps which renders AgentHome — a hero composer titled
 * "What do you want to build?" with a primary "Create agent" button. Submitting
 * mints an agent and navigates to the playground (…/playground?revisions=…),
 * which is our success signal.
 *
 * Selectors are TEXT/role based because the agent UI has essentially no
 * data-testids. If a step can't find its target when you first `pnpm record`,
 * adjust the constants below — that's the one place per flow you tune.
 */
const HERO_TEXT = "What do you want to build?";
const COMPOSER = '[contenteditable="true"], textarea';
const CREATE_BUTTON = 'button:has-text("Create agent")';
const PLAYGROUND_URL = "**/playground**";

const PROMPT = "Summarize a customer support ticket into one clear sentence.";

export default defineFlow({
  name: "create-agent",
  viewport: { width: 1920, height: 1080 },
  run: async (ctx) => {
    const { page, baseURL, moveAndClick, typeInto, pause, page_waitForURL } = ctx;

    await page.goto(baseURL, { waitUntil: "domcontentloaded" });

    // Land on Agent Home.
    await page.getByText(HERO_TEXT, { exact: false }).first().waitFor({ timeout: 30000 });
    await pause(900);

    // Type the build prompt into the hero composer.
    await typeInto(COMPOSER, PROMPT, "hero composer");
    await pause(900);

    // Create the agent.
    await moveAndClick(CREATE_BUTTON, "Create agent");

    // Success: the playground opens for the new agent.
    await page_waitForURL(PLAYGROUND_URL, { timeout: 45000 });
    await pause(1500);
  },
});
