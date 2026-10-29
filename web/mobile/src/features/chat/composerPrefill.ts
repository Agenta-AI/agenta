/**
 * The document the composer holds after a "Create with AI" starter prompt arrives. An empty
 * composer takes the prompt as is. A draft the user already wrote stays, and the prompt starts a
 * new paragraph under it, so nothing typed is lost.
 */
export const composeWithStarterPrompt = (existing: string, starterPrompt: string): string => {
    const draft = existing.trimEnd()
    const prompt = starterPrompt.trim()
    return draft.trim() ? `${draft}\n\n${prompt}` : prompt
}
