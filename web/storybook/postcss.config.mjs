import {createRequire} from "node:module"

const require = createRequire(import.meta.url)

export default {
    plugins: {
        [require.resolve("tailwindcss")]: {config: "./tailwind.config.ts"},
        [require.resolve("autoprefixer")]: {},
    },
}
