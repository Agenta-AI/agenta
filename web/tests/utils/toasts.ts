import type {Locator, Page} from "@playwright/test"

/**
 * A toast or notification raised through the `@agenta/ui` app-message facade.
 *
 * Two different surfaces can carry the text, so both are matched:
 *
 * - `message.*` is drawn by Sonner as `<li data-sonner-toast>`. Sonner sets no ARIA
 *   role on that element; `aria-live` sits on the wrapping `<section>` instead. A
 *   `role="status"` locator therefore matches nothing on this path.
 * - `notification.*` is drawn by the `@agenta/ui` `Notification`, which is
 *   `[data-slot="notification"]` and does carry `role="status"`.
 *
 * Matching on the two markers rather than on the role keeps the assertion pinned to
 * the toast surface regardless of which emitter a screen happens to use.
 */
export const appToast = (page: Page, text: string | RegExp): Locator =>
    page.locator('[data-sonner-toast], [data-slot="notification"]').filter({hasText: text}).first()
