import globalSetup from "../global-setup.ts"

try {
    await globalSetup()
} catch (error) {
    console.error("[bootstrap-auth] Global setup failed:", error)
    process.exit(1)
}
