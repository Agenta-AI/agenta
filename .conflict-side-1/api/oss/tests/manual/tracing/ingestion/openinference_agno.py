# /// script
# dependencies = ["agenta", "openinference-instrumentation-agno", "agno"]
# ///

import re
from itertools import permutations

import agenta as ag
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from openinference.instrumentation.agno import AgnoInstrumentor


ag.init()
AgnoInstrumentor().instrument()

# -------------------------------
# Simulated Data
# -------------------------------
tracking_data = {
    "TRK10001": "In transit at Berlin Friedrichshain Distribution Center",
    "TRK10002": "Delivered on 2025-06-14 at 18:32 in Charlottenburg",
    "TRK10003": "Out for delivery — last scanned near Tempelhofer Feld",
    "TRK10004": "Held at customs near Berlin Brandenburg Airport (BER)",
    "TRK10005": "Awaiting pickup at Berlin Hauptbahnhof Parcel Station",
}

distance_matrix = {
    "Warehouse": {"A": 10, "B": 15, "C": 20},
    "A": {"Warehouse": 10, "B": 12, "C": 5},
    "B": {"Warehouse": 15, "A": 12, "C": 8},
    "C": {"Warehouse": 20, "A": 5, "B": 8},
}

driver_load = {"Alice": 2, "Bob": 3, "Charlie": 1}


# -------------------------------
# Tool: TrackingTool
# -------------------------------
class TrackingTool:
    def __init__(self):
        self.name = "TrackingTool"
        self.description = "Provides shipment status updates given a tracking ID."

    def run(self, query: str) -> str:
        match = re.search(r"\bTRK\d+\b", query.upper())
        if not match:
            return "Please provide a valid tracking ID."
        tid = match.group(0)
        status = tracking_data.get(tid)
        return f"Status for {tid}: {status}" if status else f"No information for {tid}."


# -------------------------------
# Tool: RouteTool
# -------------------------------
class RouteTool:
    def __init__(self):
        self.name = "RouteTool"
        self.description = (
            "Computes the best delivery route given a start and destinations."
        )

    def run(self, query: str) -> str:
        m = re.search(r"from\s+([\w\s]+)\s+to\s+(.+)", query, re.IGNORECASE)
        if not m:
            return "Specify route as 'from <Origin> to <Dest1>, <Dest2>, ...'."
        origin = m.group(1).strip()
        dests = [d.strip() for d in re.split(r",| and ", m.group(2)) if d.strip()]
        if origin not in distance_matrix:
            return f"Unknown origin: {origin}."
        for loc in dests:
            if loc not in distance_matrix:
                return f"Unknown destination: {loc}."

        # NOTE: since route algorithm is factorial, we need to guard against too many waypoints
        MAX_WAYPOINTS = 6
        if len(dests) > MAX_WAYPOINTS:
            return "Too many destinations – please provide at most 6."

        best_order = None
        best_distance = float("inf")
        for perm in permutations(dests):
            total = 0
            cur = origin
            for nxt in perm:
                total += distance_matrix[cur][nxt]
                cur = nxt
            if total < best_distance:
                best_distance = total
                best_order = perm
        route_plan = " → ".join([origin] + list(best_order)) if best_order else origin
        return f"Optimal route: {route_plan} (Total distance: {best_distance} km)"


# -------------------------------
# Tool: WorkloadBalancerTool
# -------------------------------
class WorkloadBalancerTool:
    def __init__(self):
        self.name = "WorkloadBalancerTool"
        self.description = "Assigns delivery locations to the least busy driver."
        self.drivers = driver_load.copy()

    def run(self, query: str) -> str:
        m = re.search(r"deliver(?:y|ies)? to (.+)", query, re.IGNORECASE)
        if not m:
            return "Please specify delivery locations like 'deliver to A, B, C'."
        locations = [
            loc.strip() for loc in re.split(r",| and ", m.group(1)) if loc.strip()
        ]
        assignments = []
        for loc in locations:
            least_loaded = min(self.drivers, key=lambda d: self.drivers[d])
            assignments.append(f"{loc} → {least_loaded}")
            self.drivers[least_loaded] += 1
        return "Delivery assignments:\n" + "\n".join(assignments)


# -------------------------------
# Create Agent
# -------------------------------
agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    description="You are a smart dispatch assistant for a logistics team.",
    instructions=[
        "Use TrackingTool for shipment queries.",
        "Use RouteTool for route optimization.",
        "Use WorkloadBalancerTool to assign deliveries to drivers.",
        "Always return concise, formatted answers with relevant detail.",
    ],
    tools=[TrackingTool(), RouteTool(), WorkloadBalancerTool()],
    show_tool_calls=False,
    # markdown=True,
)


@ag.instrument()
def handle_dispatch_request(query: str):
    result = agent.run(query)
    return result.content


# -------------------------------
# Run Agent Examples
# -------------------------------
# print("Shipment Tracking")
# print(agent.run("Where is shipment TRK12345?"))

# print("\nRoute Optimization")
# print(agent.run("Find the best route from Warehouse to A, B and C"))

# print("\nWorkload Assignment")
# print(agent.run("Please assign deliveries to A, B, and C"))

# print("\nCombined Multi-Tool Request")
# print(
#     agent.run(
#         "Where is shipment TRK10001? Also, find the best route from Warehouse to A, B and C, "
#         "and assign deliveries to the least busy drivers."
#     )
# )


if __name__ == "__main__":
    print(
        "Response: ",
        handle_dispatch_request(
            query="Where is shipment TRK10001? Also, find the best route from Warehouse to A, B and C, and assign deliveries to the least busy drivers."
        ),
    )
