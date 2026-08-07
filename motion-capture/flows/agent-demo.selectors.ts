import type { Page } from "playwright";
import type { Candidate } from "../scripts/lib/selectors";

/**
 * Every element the agent-demo flow touches, in ONE place. Each target returns an
 * ordered list of candidates: role / accessible-name / placeholder first (these
 * survive antd version + styling churn), with brittle CSS classes only as a
 * last-resort fallback. When the UI shifts, fix it HERE — the flow and the recorder
 * both go through this map. `pnpm check` tells you which candidate is winning (or
 * which target broke) without a full recording.
 */
export const sel = {
  /** Signals the playground has loaded (used to wait out login/onboarding). */
  openers: (p: Page): Candidate[] => sel.modelHarnessHeader(p),

  /** The collapsible "Model & harness" section header. */
  modelHarnessHeader: (p: Page): Candidate[] => [
    { by: "role=button name=Model & harness", locator: p.getByRole("button", { name: /model\s*&\s*harness/i }) },
    { by: "[role=button] hasText", locator: p.locator('[role="button"]').filter({ hasText: /model\s*&\s*harness/i }) },
    { by: "text loose", locator: p.getByText(/model\s*&\s*harness/i) },
  ],

  /** The model selector combobox ("Pi · gpt-5.6-luna") that opens the model list. */
  modelPicker: (p: Page): Candidate[] => [
    { by: "role=combobox", locator: p.getByRole("combobox") },
    {
      by: "button hasText model-name",
      locator: p.locator("button,[role=button]").filter({ hasText: /gpt-5\.6-luna|deepseek|claude|gemini|llama|mistral/i }),
    },
    { by: ".ant-select:visible", locator: p.locator(".ant-select:visible") },
  ],

  /** The search box inside the open model dropdown. */
  modelSearch: (p: Page): Candidate[] => [
    { by: 'input[type=search]', locator: p.locator('input[type="search"]:visible') },
    { by: "placeholder=Search", locator: p.getByPlaceholder(/search/i) },
    { by: ".ant-select search input", locator: p.locator(".ant-select-selection-search-input:visible") },
    { by: ".ant-select-dropdown input", locator: p.locator(".ant-select-dropdown input:visible") },
  ],

  /** A specific option in the open model dropdown. `name` is a RegExp. */
  modelOption: (p: Page, name: RegExp): Candidate[] => [
    { by: "role=option name", locator: p.getByRole("option", { name }) },
    { by: ".ant-select-item-option hasText", locator: p.locator(".ant-select-item-option:visible").filter({ hasText: name }) },
    { by: "text", locator: p.getByText(name) },
  ],

  /** The provider API-key field. */
  apiKeyField: (p: Page): Candidate[] => [
    { by: "label=API key", locator: p.getByLabel(/api key/i) },
    { by: "placeholder=sk-", locator: p.getByPlaceholder(/^sk-/i) },
    { by: 'input[placeholder^=sk-]', locator: p.locator('input[placeholder^="sk-"]:visible') },
    { by: "input[type=password]", locator: p.locator('input[type="password"]:visible') },
  ],

  /** The Save button that commits the credentials. */
  saveButton: (p: Page): Candidate[] => [
    { by: "role=button name=Save", locator: p.getByRole("button", { name: /^save$/i }) },
    { by: "button hasText Save", locator: p.locator("button").filter({ hasText: /^save$/i }) },
  ],
};

export type SelectorMap = typeof sel;
