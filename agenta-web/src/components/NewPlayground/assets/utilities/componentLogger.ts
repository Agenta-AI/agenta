export const componentLogger = (componentName: string, ...message: any[]) => {
    console.debug(
        `NEW PLAYGROUND[%cComponent%c] - ${componentName} - RENDER!`,
        "color: orange",
        "",
        ...message,
    )
}
