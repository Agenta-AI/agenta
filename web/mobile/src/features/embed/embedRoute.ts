/** The widget route, with or without the `/m` base path. */
export const isEmbedPath = (pathname: string): boolean => /^(\/m)?\/embed(\/|$)/.test(pathname)
