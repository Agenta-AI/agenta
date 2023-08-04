from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient("mongodb://username:password@mongo:27017")
database = client["agenta"]

evaluation_scenarios = database["evaluation_scenarios"]
evaluations = database["evaluation"]
testsets = database["testsets"]
