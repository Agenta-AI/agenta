import { defineFlow } from "../scripts/lib/flow";
import { resolveFirst, softFirst } from "../scripts/lib/selectors";
import { sel } from "./agent-demo.selectors";

/**
 * Demo (recorded, after login):
 *  4. click "Model & harness"   5. open the model selector   6. search "deepseek v4 flash"
 *  7. select "DeepSeek V4 Flash" 8. type a random API key     9. click Save
 *
 * Every element comes from the centralized, role-first map in `agent-demo.selectors.ts`
 * via `resolveFirst`, which logs the winning strategy (✓ … via …) and, on a miss, throws
 * a SelectorError showing what's actually on screen. Run `pnpm check` to verify all
 * selectors resolve without a full recording. Each step screenshots to /tmp/agenta-inspect.
 */
const DIAG = "/tmp/agenta-inspect";
const RANDOM_KEY =
  "sk-demo-" + Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 14);
const DEEPSEEK = /deepseek\s*v4\s*flash/i;

export default defineFlow({
  name: "agent-demo",
  viewport: { width: 1920, height: 1080 },
  run: async (ctx) => {
    const { page, moveAndClick, typeInto, pause } = ctx;
    const shot = (n: string) => page.screenshot({ path: `${DIAG}/step-${n}.png` }).catch(() => {});

    // 4) Click the Model & harness section header.
    await shot("00-start");
    const header = await resolveFirst(page, "Model & harness header", sel.modelHarnessHeader(page));
    await moveAndClick(header, "Model & harness");
    await pause(1100);
    await shot("01-expanded");

    // The section is inline in this build; if the header click happened to collapse it,
    // click again so the model selector is present before we open it.
    if (!(await softFirst(sel.modelPicker(page)))) {
      const retry = await resolveFirst(page, "Model & harness header (retry)", sel.modelHarnessHeader(page));
      await moveAndClick(retry, "open Model & harness");
      await pause(900);
    }

    // 5) Open the model dropdown.
    const picker = await resolveFirst(page, "model picker", sel.modelPicker(page));
    await moveAndClick(picker, "open model list");
    await pause(1100);
    await shot("02-picker-open");

    // 6) Search.
    const search = await resolveFirst(page, "model search", sel.modelSearch(page));
    await typeInto(search, "deepseek v4 flash", "search deepseek v4 flash");
    await pause(1600);
    await shot("03-searched");

    // 7) Select DeepSeek V4 Flash from the open dropdown.
    const option = await resolveFirst(page, "DeepSeek V4 Flash option", sel.modelOption(page, DEEPSEEK));
    await moveAndClick(option, "select DeepSeek V4 Flash");
    await pause(1600);
    await shot("04-selected");

    // Selecting a model can auto-collapse the section — re-open so the key field shows.
    if (!(await softFirst(sel.apiKeyField(page)))) {
      const h = await softFirst(sel.modelHarnessHeader(page));
      if (h) {
        await moveAndClick(h, "re-open Model & harness");
        await pause(1000);
        await shot("04b-reexpanded");
      }
    }

    // 8) Enter a random API key.
    const keyField = await resolveFirst(page, "API key field", sel.apiKeyField(page));
    await typeInto(keyField, RANDOM_KEY, "API key");
    await pause(1100);
    await shot("05-key");

    // 9) Save.
    const save = await resolveFirst(page, "Save button", sel.saveButton(page));
    await moveAndClick(save, "Save");
    await pause(2500);
    await shot("06-saved");
  },
});
