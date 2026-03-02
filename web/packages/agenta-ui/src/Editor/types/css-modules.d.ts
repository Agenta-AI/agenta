/**
 * Type declarations for CSS modules
 */
declare module "*.module.css" {
    const classes: Record<string, string>
    export default classes
}

declare module "*.css" {
    const content: Record<string, string>
    export default content
}
