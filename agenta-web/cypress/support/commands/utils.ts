Cypress.Commands.add("clickLinkAndWait", (selector) => {
    cy.get(selector).first().as("link")
    cy.get("@link").click()
})
