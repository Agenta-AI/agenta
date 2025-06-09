/**
 * This script cleans up after Playwright tests.
 */

/**
 * Runs after tests complete.
 * Attempts to delete all accounts in local OSS testing environments.
 * Uses environment variables to determine eligibility and endpoint configuration.
 */
async function globalTeardown(config: any) {
    console.log("Starting global teardown...")
    const project = config.projects.find((project: any) => project.name === process.env.PROJECT)
    console.log(`Resolved project: ${process.env.PROJECT}`, project)
    if (!project) {
        throw new Error(`Project ${process.env.PROJECT} not found`)
    }
    const {baseURL} = project.use
    console.log(`Using web-url: ${baseURL}`)

    const token = process.env.AGENTA_AUTH_KEY
    const apiURL = process.env.AGENTA_API_URL || `${baseURL}/api`
    console.log(`Using api-url: ${apiURL}`)

    console.log(
        `Environment variables - token: ${token ? "present" : "absent"}, LICENSE: ${process.env.LICENSE}, PROJECT: ${process.env.PROJECT}`,
    )
    if (token && process.env.LICENSE === "oss" && process.env.PROJECT === "local") {
        console.log("Conditions met for deleting all accounts, sending request...")
        try {
            await fetch(`${apiURL}/admin/accounts/delete-all`, {
                method: "POST",
                headers: {
                    Authorization: `Access ${token}`,
                },
            })
            console.log("Deleted all accounts successfully")
        } catch (error) {
            console.error("Error deleting accounts:", error)
        }
    } else {
        console.log("Cannot delete all accounts: conditions not met")
    }
}

export default globalTeardown
