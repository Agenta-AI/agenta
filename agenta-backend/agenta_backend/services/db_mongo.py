from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient("mongodb://username:password@mongo:27017")
database = client["agenta"]

evaluation_scenarios = database["evaluation_scenarios"]
comparison_tables = database["comparison_tables"]
datasets = database["datasets"]
