from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient("mongodb://username:password@mongo:27017")
database = client["agenta"]

evaluation_rows = database["evaluation_rows"]
comparison_tables = database["comparison_tables"]
testsets = database["testsets"]
