Cypress.Commands.add("clickLinkAndWait", (selector) => {
    cy.get(selector).first().as("link")
    cy.get("@link").click()
})

export const isDemo = () => {
    if (Cypress.env["NEXT_PUBLIC_FF"]) {
        return ["cloud", "ee"].includes(Cypress.env["NEXT_PUBLIC_FF"])
    }
    return false
}
