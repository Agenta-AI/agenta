import {defineConfig} from "cypress"
import process from "process"

export default defineConfig({
    video: false,
    screenshotOnRunFailure: false,
    e2e: {
        baseUrl: "http://localhost",
        defaultCommandTimeout: 8000,
    },
    env: {
        baseApiURL: "http://localhost/api",
        OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY || "your_api_key_here",
        localBaseUrl: "http://localhost",
        NEXT_PUBLIC_FF: false,
    },
})
