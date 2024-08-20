import {defineConfig} from "cypress"
import {config} from "dotenv"

// read in the environment variables from .env.local file
config({path: ".env.local"})

export default defineConfig({
    video: false,
    screenshotOnRunFailure: false,
    e2e: {
        baseUrl: "http://localhost:3000",
        defaultCommandTimeout: 75000,
        requestTimeout: 60000,
        setupNodeEvents(on) {
            on("task", {
                log(message) {
                    console.log(message)
                    return null
                },
            })
        },
        experimentalStudio: true,
        specPattern: ["cypress/e2e/1-smoke-tests.cy.ts"],
    },
    env: {
        baseApiURL: "http://localhost/api",
        NEXT_PUBLIC_OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        NEXT_PUBLIC_FF: false,
    },
})
