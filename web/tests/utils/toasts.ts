import type {Locator, Page} from "@playwright/test"

/**
 * A toast, whichever of the three surfaces the app raised it on.
 *
 * The product runs two toast systems side by side, and one screen can use either
 * depending on which component handles the action, so an assertion that names a single
 * surface is a coin flip:
 *
 * - `message.*` from `@agenta/ui/app-message` is drawn by Sonner as
 *   `<li data-sonner-toast>`. Sonner sets no ARIA role on it; `aria-live` sits on the
 *   wrapping `<section>`, so a `role="status"` locator matches nothing here.
 * - `notification.*` from the same facade is drawn by the `@agenta/ui` `Notification`,
 *   which is `[data-slot="notification"]`.
 * - `message.*` imported straight from `antd` still renders `.ant-message`. Several
 *   components do this, `WorkflowRevisionDrawerWrapper` among them.
 *
 * Matching all three keeps a test green when a screen moves between them.
 */
export const appToast = (page: Page, text: string | RegExp): Locator =>
    page
        .locator('[data-sonner-toast], [data-slot="notification"], .ant-message')
        .filter({hasText: text})
        .first()
