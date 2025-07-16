# /// script
# dependencies = ["pydantic-ai[examples]", "logfire", "agenta"]
# ///

from dataclasses import dataclass
from pydantic import BaseModel, Field

from pydantic_ai import Agent, RunContext
import logfire
import agenta as ag
from dotenv import load_dotenv

load_dotenv(override=True)

# os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost/api/otlp/"
# os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = f"Authorization=ApiKey {os.environ['AGENTA_API_KEY']}"

ag.init()
logfire.configure(
    service_name="my_logfire_service", send_to_logfire=False, scrubbing=False
)
logfire.instrument_asyncpg()


class DatabaseConn:
    """This is a fake database for example purposes.

    In reality, you'd be connecting to an external database
    (e.g. PostgreSQL) to get information about customers.
    """

    @classmethod
    async def customer_name(cls, *, id: int) -> str | None:
        if id == 123:
            return "John"
        return None

    @classmethod
    async def customer_balance(cls, *, id: int, include_pending: bool) -> float:
        if id == 123 and include_pending:
            return 123.45
        else:
            raise ValueError("Customer not found")


@dataclass
class SupportDependencies:
    customer_id: int
    including_pending: bool
    db: DatabaseConn


class SupportOutput(BaseModel):
    support_advice: str = Field(description="Advice returned to the customer")
    block_card: bool = Field(description="Whether to block their card or not")
    risk: int = Field(description="Risk level of query", ge=0, le=10)


support_agent = Agent(
    "openai:gpt-4o",
    deps_type=SupportDependencies,
    output_type=SupportOutput,
    system_prompt=(
        "You are a support agent in our bank, give the "
        "customer support and judge the risk level of their query. "
        "Reply using the customer's name."
    ),
    instrument=True,
)


@support_agent.system_prompt
async def add_customer_name(ctx: RunContext[SupportDependencies]) -> str:
    customer_name = await ctx.deps.db.customer_name(id=ctx.deps.customer_id)
    return f"The customer's name is {customer_name!r}"


@support_agent.tool
async def customer_balance(ctx: RunContext[SupportDependencies]) -> str:
    """Returns the customer's current account balance."""
    balance = await ctx.deps.db.customer_balance(
        id=ctx.deps.customer_id,
        include_pending=ctx.deps.including_pending,
    )
    return f"${balance:.2f}"


@ag.instrument()
def bank_balance(customer_id: int, query: str, include_pending: bool = True):
    """Returns the customer's current account balance."""
    deps = SupportDependencies(
        customer_id=customer_id,
        including_pending=include_pending,
        db=DatabaseConn(),
    )
    result = support_agent.run_sync(query, deps=deps)
    return result


@ag.instrument()
def block_card(customer_id: int, query: str, include_pending: bool = True):
    """Blocks the customer's card if they report it lost."""
    deps = SupportDependencies(
        customer_id=customer_id,
        including_pending=include_pending,
        db=DatabaseConn(),
    )
    result = support_agent.run_sync(query, deps=deps)
    return result


if __name__ == "__main__":
    # Agenta 1: get user's account balance
    result = bank_balance(123, "What is my balance?", True)
    print(result.output)

    # Agent 2: block user's card if they report it lost
    result = block_card(123, "I just lost my card!", True)
    print(result.output)
