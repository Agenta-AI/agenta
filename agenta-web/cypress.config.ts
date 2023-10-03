import {defineConfig} from "cypress"

export default defineConfig({
    e2e: {
        baseUrl: "http://localhost:3000",
        defaultCommandTimeout: 6000,
    },
    env: {
        baseApiURL: "http://localhost/api",
        OPENAI_API_KEY: "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",
        localBaseUrl: "http://localhost",
    },
})
