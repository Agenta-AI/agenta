import {defineConfig} from "cypress"

export default defineConfig({
    e2e: {
        baseUrl: "http://localhost:3000",
        defaultCommandTimeout: 6000,
    },
    env: {
        baseApiURL: "http://localhost/api",
    },
})
