export const formatDate = (dateString: string): string => {
    const date = new Date(dateString)

    const dateOptions: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }
    const timeOptions: Intl.DateTimeFormatOptions = {
        hour: "2-digit",
        minute: "2-digit",
    }

    const formattedDate = date.toLocaleDateString("en-DE", dateOptions)
    const formattedTime = date.toLocaleTimeString("en-DE", timeOptions)

    return `${formattedDate} ${formattedTime}`
}
