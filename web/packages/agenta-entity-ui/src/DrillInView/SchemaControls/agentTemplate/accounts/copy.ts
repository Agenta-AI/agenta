/**
 * Texts of the "Account" block in an item's drawer and of "Attach a secret".
 *
 * APPROVED (UX-DECISIONS.md, 2026-10-29): the label "Account", "Each person's default <name>",
 * "Each person's own sign-in", "The project's sign-in", "When you run it: <account> (your
 * default)", "Change", "Make it my default for every agent", "Connect another <name> account",
 * "When you run it: signed in as you", "Sign out".
 *
 * Every other text here is a DRAFT for the owner's text pass.
 */
export const ACCOUNT_COPY = {
    label: "Account",
    eachPersonDefault: (name: string) => `Each person's default ${name}`,
    eachPersonSignIn: "Each person's own sign-in",
    projectSignIn: "The project's sign-in",
    whenYouRun: (account: string) => `When you run it: ${account}`,
    yourDefault: "(your default)",
    change: "Change",
    makeDefault: "Make it my default for every agent",
    connectAnother: (name: string) => `Connect another ${name} account`,
    signedInAsYou: "When you run it: signed in as you",
    signOut: "Sign out",
    // Drafts.
    noAccountYet: (name: string) => `When you run it: you have no ${name} account yet`,
    connectOne: "Connect one",
    noneChosen: "When you run it: none of your accounts is chosen",
    choose: "Choose",
    notSignedIn: "When you run it: not signed in",
    signInExpired: "When you run it: your sign-in expired",
    signIn: "Sign in",
    tokenPlaceholder: "Your token",
    saveToken: "Save",
    defaultMark: "Default",
    choiceFailed: "Could not save your choice. Try again.",
    defaultFailed: "Could not change your default. Try again.",
    // "Attach a secret" (drafts).
    eachPersonSecret: "Each person's own secret",
    projectSecret: "A project secret",
    secretValueLine: "Each person who runs the agent gives their own value.",
    noSecretYet: "When you run it: you have no secret of your own yet",
    userSecretRow: "Each person's own secret",
} as const
