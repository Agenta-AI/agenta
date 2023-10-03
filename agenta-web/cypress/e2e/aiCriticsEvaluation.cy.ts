describe("AI Critics Evaluation workflow", () => {
    context("When successfully navigating to the evaluation path", () => {
        it("should navigate to evaluation page", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("when selecting evaluation without apikey", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        })
        it("should ok button", () => {
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

        it("should nav button", () => {
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

    context.only("when apikey provided", () => {
        it("should ok button", () => {
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
                url: "http://localhost/api/evaluations/?app_name=await",
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
                    "GET",
                    `http://localhost/api/evaluations/${
                        response.body[response.body.length - 1].id
                    }/results`,
                ).as("getReq")
                cy.wait("@getReq", {requestTimeout: 15000}).then((interception) => {
                    expect(interception.response.statusCode).to.eq(200)
                    cy.get('[data-cy="ai-critic-evaluation-result"]').should(
                        "contain.text",
                        "Results Data:",
                    )
                })
            })
            cy.get(".ant-message-notice-content").should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        })
    })
})
