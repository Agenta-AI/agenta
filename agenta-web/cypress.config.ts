import {defineConfig} from "cypress"

export default defineConfig({
    e2e: {
        baseUrl: "http://localhost:3000",
        defaultCommandTimeout: 6000,
    },
    env: {
        baseApiURL: Cypress.env("http://localhost/api"),
        OPENAI_API_KEY:  Cypress.env("your_api_key_here"),
        localBaseUrl: Cypress.env("http://localhost"),
    },
})
