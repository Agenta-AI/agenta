import {defineConfig} from "cypress"
import {config} from "dotenv"

// read in the environment variables from .env.local file
config({path: ".env.local"})

export default defineConfig({
    video: false,
    screenshotOnRunFailure: false,
    e2e: {
        baseUrl: "http://localhost:3000",
        defaultCommandTimeout: 360000,
        requestTimeout: 360000,
        pageLoadTimeout: 360000,
        responseTimeout: 360000,
        taskTimeout: 360000,
        execTimeout: 360000,
        setupNodeEvents(on) {
            on("task", {
                log(message) {
                    console.log(message)
                    return null
                },
            })
        },
        experimentalStudio: true,
    },
    env: {
        baseApiURL: "http://localhost/api",
        NEXT_PUBLIC_OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        NEXT_PUBLIC_FF: false,
    },
})
