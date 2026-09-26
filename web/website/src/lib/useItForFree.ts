// Kept apart from templates.ts so client islands do not bundle the catalog JSON.
export const USE_IT_FOR_FREE_LABEL = "Use it for free";
export const APP_URL = "https://cloud.agenta.ai/";

// The app captures ?template=<key>, keeps it through signup/sign-in, and
// loads that package. The website never creates agents itself.
export const useItForFreeUrl = (
  key: string,
  appUrl: string = APP_URL,
): string => {
  const url = new URL(appUrl);
  url.searchParams.set("template", key);
  return url.toString();
};
