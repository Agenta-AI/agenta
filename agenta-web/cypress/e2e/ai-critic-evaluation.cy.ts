describe("AI Critics Evaluation workflow", () => {
    context("When navigating successfully to the evaluation path", () => {
        it("Should navigate to evaluation page", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When you select evaluation in the absence of an API key", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        })

        it("Should display modal", () => {
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.get('[data-cy="ai-critic-button"]').click()
            cy.get('[data-cy="variants-dropdown"]').eq(0).click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="selected-testset"]').click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("exist")
            cy.get('[data-cy="evaluation-error-modal-ok-button"]').click()
        })

        it("Should display modal and naviagte to apikeys", () => {
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.get('[data-cy="ai-critic-button"]').click()
            cy.get('[data-cy="variants-dropdown"]').eq(0).click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="selected-testset"]').click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("exist")
            cy.get('[data-cy="evaluation-error-modal-nav-button"]').click()
            cy.url().should("include", "/apikeys")
        })
    })

    context("When you select evaluation in the presence of an API key", () => {
        const appVariant = "capitals"

        it("Should executes a complete evaluation workflow", () => {
            cy.visit("/apikeys")
            cy.get('[data-cy="apikeys-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
            cy.get('[data-cy="apikeys-save-button"]').click()
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.get('[data-cy="ai-critic-button"]').click()
            cy.get('[data-cy="variants-dropdown"]').eq(0).click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="selected-testset"]').click()
            cy.get("li.ant-dropdown-menu-item").eq(0).click()
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get('[data-cy="evaluation-error-modal"]').should("not.exist")
            cy.url().should("include", "/auto_ai_critique")
            cy.get('[data-cy="ai-critic-evaluation-result"]').should(
                "contain.text",
                "Run evaluation to see results!",
            )
            cy.get(".ant-message-notice-content").should("not.exist")
            cy.wait(1000)
            cy.clickLinkAndWait('[data-cy="ai-critic-run-evaluation"]')

            cy.request({
                url: `http://localhost/api/evaluations/?app_name=${appVariant}`,
                method: "GET",
            }).then((response) => {
                expect(response.status).to.equal(200)
                cy.request({
                    url: `http://localhost/api/evaluations/${
                        response.body[response.body.length - 1].id
                    }/evaluation_scenarios`,
                    method: "GET",
                }).then((getResponse) => {
                    expect(getResponse.status).to.equal(200)
                })
                cy.request({
                    url: `http://localhost/api/evaluations/${
                        response.body[response.body.length - 1].id
                    }`,
                    method: "PUT",
                    body: {
                        status: "EVALUATION_FINISHED",
                    },
                }).then((putResponse) => {
                    expect(putResponse.status).to.equal(200)
                })
                cy.intercept(
                    "POST",
                    `http://localhost/api/evaluations/evaluation_scenario/ai_critique`,
                ).as("postRequest")
                cy.wait("@postRequest", {requestTimeout: 15000}).then((interception) => {
                    expect(interception.response.statusCode).to.eq(200)
                })
            })

            cy.get('[data-cy="ai-critic-evaluation-result"]').should(
                "contain.text",
                "Results Data:",
            )
            cy.get(".ant-message-notice-content").should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        })
    })
})
