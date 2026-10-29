"""Two mock actions over two transports, one per price shape.

`mock.enrich_person` runs on the mock REST provider and is priced per successful call.
`mock.search_companies` runs on the mock MCP provider and is priced per result, capped.
The data is deterministic and fake.
"""

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from oss.src.core.managed_tools.dtos import (
    ManagedAction,
    ManagedActionBinding,
    ManagedActionUnit,
)

MOCK_REST_PROVIDER = "mock_rest"
MOCK_MCP_PROVIDER = "mock_mcp"


class EnrichPersonInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        description="The person's work email address.",
    )


class EnrichedPerson(BaseModel):
    name: str
    title: str
    company: str
    linkedin_url: str


class EnrichPersonOutput(BaseModel):
    person: EnrichedPerson


class SearchCompaniesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=200, description="What to search for.")
    # Bounds what the upstream charges us; the rate card's cap bounds what we charge.
    limit: int = Field(default=5, ge=1, le=25, description="At most this many results.")


class Company(BaseModel):
    name: str
    domain: str
    employees: int
    industry: Optional[str] = None


class SearchCompaniesOutput(BaseModel):
    companies: List[Company]


ENRICH_PERSON = ManagedAction(
    integration="mock",
    name="enrich_person",
    description=(
        "Look up a person's name, title, company and profile from their work email. "
        "Mock data."
    ),
    input_model=EnrichPersonInput,
    output_model=EnrichPersonOutput,
    binding=ManagedActionBinding(
        provider=MOCK_REST_PROVIDER,
        operation="people/enrich",
        # The mock upstream charges extra when asked to reveal a phone number.
        fixed_arguments={"reveal_phone_number": False},
    ),
    unit=ManagedActionUnit.CALLS,
    read_only=True,
    timeout_seconds=15,
)

SEARCH_COMPANIES = ManagedAction(
    integration="mock",
    name="search_companies",
    description="Search companies by a free-text query. Mock data.",
    input_model=SearchCompaniesInput,
    output_model=SearchCompaniesOutput,
    binding=ManagedActionBinding(
        provider=MOCK_MCP_PROVIDER, operation="search_companies"
    ),
    unit=ManagedActionUnit.RESULTS,
    results_field="companies",
    read_only=True,
    timeout_seconds=15,
)

MOCK_ACTIONS = (ENRICH_PERSON, SEARCH_COMPANIES)
