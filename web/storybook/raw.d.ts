// `?raw` imports resolve through the `asset/source` rule in .storybook/main.ts.
declare module "*?raw" {
    const content: string
    export default content
}
