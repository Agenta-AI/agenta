import {defineConfig} from "cypress"
import {config} from "dotenv"

// read in the environment variables from .env.local file
config({path: ".env.local"})

export default defineConfig({
    video: false,
    screenshotOnRunFailure: false,
    e2e: {
        baseUrl: "http://localhost",
        defaultCommandTimeout: 15000,
        requestTimeout: 10000,
        taskTimeout: 8000,
        execTimeout: 8000,
        pageLoadTimeout: 10000,
        responseTimeout: 10000,
        specPattern: ["*/e2e/playground.cy.ts"],
    },
    env: {
        baseApiURL: "http://localhost/api",
        OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        NEXT_PUBLIC_FF: false,
    },
})
