/**
 * Shared CSS module type declarations for all @agenta/* packages
 */
declare module "*.module.css" {
    const classes: {[key: string]: string}
    export default classes
}

declare module "*.css" {
    const content: {[key: string]: string}
    export default content
}
