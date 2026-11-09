/**
 * The Microsoft Teams setup steps, in one place. The path is the Teams Developer Portal; the
 * docs link the Azure portal path. Change the steps here when the path changes.
 */

export const TEAMS_DEVELOPER_PORTAL_URL = "https://dev.teams.microsoft.com/bots"
export const ENTRA_ADMIN_CENTER_URL = "https://entra.microsoft.com"

/** The steps before the connection exists, ending with the step that holds the fields. */
export const TEAMS_CONNECT_STEPS = {
    register: {
        title: "Register a bot",
        body: "In the Teams Developer Portal, open Tools, then Bot management, and select New bot.",
        link: "Open the Developer Portal",
    },
    secret: {
        title: "Add a client secret",
        body: "On the bot's Client secrets page, add a client secret and copy its value. The app ID is on the bot page.",
    },
    tenant: {
        title: "Copy your tenant ID",
        body: "It is on the Overview page of the Microsoft Entra admin center.",
        link: "Open Microsoft Entra",
    },
    paste: {
        title: "Paste the three values",
        body: "We check them with Microsoft, then keep the secret masked.",
    },
} as const

/** The steps after connect: point the bot at Agenta, then install the app in Teams. */
export const TEAMS_APP_STEPS = {
    connected: "Connected. Two steps left in Teams.",
    endpoint: {
        title: "Paste the messaging endpoint",
        body: "In the Developer Portal, open your bot, then Configure, and paste this as the endpoint address.",
        label: "Messaging endpoint",
    },
    install: {
        title: "Install the app in Teams",
        download: "Download Teams app",
        upload: "In Teams, open Apps, then Manage your apps, then Upload an app, and choose the downloaded file.",
        noUpload: "No Upload an app option? Ask your Teams admin to allow custom apps.",
    },
    loadError: "Could not load the Teams app.",
} as const
