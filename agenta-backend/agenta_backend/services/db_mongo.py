from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.collection import Collection

client = AsyncIOMotorClient("mongodb://username:password@mongo:27017")
database = client["agenta"]

evaluation_scenarios: Collection = database["evaluation_scenarios"]
evaluations: Collection = database["evaluations"]
testsets: Collection = database["testsets"]
users: Collection = database["users"]
organization: Collection = database["organization"]
