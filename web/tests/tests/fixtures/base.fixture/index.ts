import {test as playwright, type Page} from "@playwright/test"

import {apiHelpers} from "./apiHelpers"
import {testProviderHelpers} from "./providerHelpers"
import type {BaseFixture} from "./types"
import {uiHelpers} from "./uiHelpers"

const ONBOARDING_ACTIVE_USER_ID_KEY = "agenta:onboarding:active-user-id"
const ONBOARDING_SEEN_TOURS_KEY_SUFFIX = "seen-tours"
const ONBOARDING_IS_NEW_USER_KEY_SUFFIX = "is-new-user"
const ONBOARDING_WIDGET_STATUS_KEY_SUFFIX = "widget-status"
const ONBOARDING_WIDGET_UI_KEY_SUFFIX = "widget-ui"
const ONBOARDING_WIDGET_SEEN_CLOSE_TOOLTIP_KEY_SUFFIX = "widget-seen-close-tooltip"
const ONBOARDING_WIDGET_CLOSED_TOUR_ID = "onboarding-widget-closed-tour"
const ONBOARDING_WIDGET_DISMISSED_STATUS = "dismissed"

const installOnboardingGuideSuppression = async (page: Page) => {
    await page.addInitScript(
        ({
            activeUserIdKey,
            seenToursKeySuffix,
            isNewUserKeySuffix,
            widgetStatusKeySuffix,
            widgetUiKeySuffix,
            widgetSeenCloseTooltipKeySuffix,
            widgetClosedTourId,
            dismissedWidgetStatus,
        }) => {
            const applyOnboardingStateForUser = (userId: string) => {
                if (!userId) return

                const baseKey = `agenta:onboarding:${userId}:`
                const seenToursKey = `${baseKey}${seenToursKeySuffix}`
                const isNewUserKey = `${baseKey}${isNewUserKeySuffix}`
                const widgetStatusKey = `${baseKey}${widgetStatusKeySuffix}`
                const widgetUiKey = `${baseKey}${widgetUiKeySuffix}`
                const widgetSeenCloseTooltipKey = `${baseKey}${widgetSeenCloseTooltipKeySuffix}`

                const currentSeenTours = window.localStorage.getItem(seenToursKey)
                let parsedSeenTours: Record<string, number | boolean> = {}

                if (currentSeenTours) {
                    try {
                        parsedSeenTours = JSON.parse(currentSeenTours) as Record<
                            string,
                            number | boolean
                        >
                    } catch {
                        parsedSeenTours = {}
                    }
                }

                window.localStorage.setItem(
                    seenToursKey,
                    JSON.stringify({
                        ...parsedSeenTours,
                        [widgetClosedTourId]: parsedSeenTours[widgetClosedTourId] ?? Date.now(),
                    }),
                )
                window.localStorage.setItem(isNewUserKey, JSON.stringify(false))
                window.localStorage.setItem(widgetStatusKey, JSON.stringify(dismissedWidgetStatus))
                window.localStorage.setItem(
                    widgetUiKey,
                    JSON.stringify({
                        isOpen: false,
                        isMinimized: false,
                    }),
                )
                window.localStorage.setItem(widgetSeenCloseTooltipKey, JSON.stringify(true))
            }

            const maybeApplyForActiveUser = (value: string | null) => {
                if (!value) return
                applyOnboardingStateForUser(value)
            }

            maybeApplyForActiveUser(window.localStorage.getItem(activeUserIdKey))

            const originalSetItem = Storage.prototype.setItem
            Storage.prototype.setItem = function (key: string, value: string) {
                originalSetItem.call(this, key, value)

                if (this === window.localStorage && key === activeUserIdKey) {
                    maybeApplyForActiveUser(value)
                }
            }
        },
        {
            activeUserIdKey: ONBOARDING_ACTIVE_USER_ID_KEY,
            seenToursKeySuffix: ONBOARDING_SEEN_TOURS_KEY_SUFFIX,
            isNewUserKeySuffix: ONBOARDING_IS_NEW_USER_KEY_SUFFIX,
            widgetStatusKeySuffix: ONBOARDING_WIDGET_STATUS_KEY_SUFFIX,
            widgetUiKeySuffix: ONBOARDING_WIDGET_UI_KEY_SUFFIX,
            widgetSeenCloseTooltipKeySuffix: ONBOARDING_WIDGET_SEEN_CLOSE_TOOLTIP_KEY_SUFFIX,
            widgetClosedTourId: ONBOARDING_WIDGET_CLOSED_TOUR_ID,
            dismissedWidgetStatus: ONBOARDING_WIDGET_DISMISSED_STATUS,
        },
    )
}

const _test = playwright.extend<BaseFixture>({
    page: async ({page}, use) => {
        await installOnboardingGuideSuppression(page)
        await use(page)
    },
    apiHelpers: apiHelpers(),
    uiHelpers: uiHelpers(),
    testProviderHelpers: testProviderHelpers(),
})

export {_test as test}
