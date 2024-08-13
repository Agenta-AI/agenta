const promptConfig = {
    inputs: {country: "Germany"},
    environment: "development",
}

describe("Deploy app without errors", () => {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    it("Should publish a vriant", () => {
        cy.visit(`/apps/${app_id}/playground`)
        cy.url().should("include", "/playground")
        cy.contains(/modify parameters/i)
        cy.get('[data-cy="playground-publish-button"]').click()
        cy.get(".ant-modal-content").should("exist")
        cy.contains("production (app.default v1 is published in this environment)").should(
            "be.exist",
        )
        cy.get('[name="development"]').check().should("be.checked")
        cy.get(".ant-modal-content").within(() => {
            cy.get("button")
                .contains(/publish/i)
                .click()
        })
    })

    it("Should test the published variant", () => {
        cy.visit(`/apps/${app_id}/endpoints`)
        cy.url().should("include", "/endpoints")
        cy.contains(/api endpoint/i)
        cy.get("span")
            .contains(/development/i)
            .should("not.be.disabled")
            .click()
        // extracting api from the UI and testing it
        cy.get(':nth-child(4) > [style="color: rgb(47, 156, 10);"]')
            .invoke("text")
            .then((text) => {
                const url = decodeURIComponent(
                    `${Cypress.env().baseApiURL.replace("/api", "")}/${text.replace("http://localhost/", "")}`,
                )

                cy.request("POST", url.replace(/"/g, ""), promptConfig).then((response) => {
                    expect(response.body).to.have.property("message")
                })
            })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
