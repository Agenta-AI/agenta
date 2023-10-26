import {defineConfig} from "cypress"

const cypressApiKey="cypressApiKey";

export default defineConfig({
    video: false,
    screenshotOnRunFailure: false,
    e2e: {
        baseUrl: "http://localhost",
        defaultCommandTimeout: 8000,
    },
    env: {
        baseApiURL: "http://localhost/api",
        OPENAI_API_KEY: "your_api_key_here",
        localBaseUrl: "http://localhost",
        NEXT_PUBLIC_FF: false,
        CYPRESS_API_KEY: process.env[cypressApiKey] ?? "your_fallback_api_key_here",
    },
})
