/**
 * Ambient CSS module declarations for the app.
 * Classic tsc tolerates untyped side-effect CSS imports under moduleResolution:bundler;
 * the native compiler (TS7) requires a declaration. This mirrors packages/css-modules.d.ts.
 */
declare module "*.module.css" {
    const classes: {[key: string]: string}
    export default classes
}

declare module "*.css" {
    const content: {[key: string]: string}
    export default content
}
