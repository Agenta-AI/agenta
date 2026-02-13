import {devices, type Project} from "@playwright/test"

/**
 * Single project configuration.
 * Base URL comes from AGENTA_WEB_URL, license from AGENTA_LICENSE.
 */
export const project: Project = {
    name: process.env.AGENTA_LICENSE || "oss",
    use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.AGENTA_WEB_URL || "http://localhost",
    },
}
