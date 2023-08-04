describe("template spec", () => {
    const apiBaseUrl = "http://localhost:3000"
    it("passes", () => {
        cy.visit(`${apiBaseUrl}/dashboard`)
    })
})
