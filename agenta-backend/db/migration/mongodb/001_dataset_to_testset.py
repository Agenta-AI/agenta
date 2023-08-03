""" The provided Python script uses pymongo to connect to a MongoDB database, "agenta".
 It retrieves all documents from a source collection, "datasets", processes these 
 documents in chunks to manage memory efficiently, and inserts the documents into a 
 target collection, "testsets", if they do not already exist there, preventing duplication.
"""
from pymongo import MongoClient

# Initialize the MongoDB client
client = MongoClient("mongodb://username:password@0.0.0.0:27017")

# Specify the database
db = client["agenta"]

# Specify the source and target collections
source_collection = db["datasets"]
target_collection = db["testsets"]

# Fetch all documents from the source collection
source_documents = source_collection.find()
# print(source_documents.count())

# Calculate Total Documents
total_docs = source_collection.count_documents({})

# Define Chunk Size
chunk_size = 100

# Calculate Number of Chunks
num_chunks = total_docs // chunk_size + (total_docs % chunk_size > 0)

# Fetch and Process Chunks
for i in range(num_chunks):
    # Define Skip and Limit Values
    skip = i * chunk_size
    limit = chunk_size

    # Fetch Chunk of Documents
    chunk_docs = source_collection.find({}).skip(skip).limit(limit)

    # Process Documents
    for doc in chunk_docs:
        # Check if this document is already in the target collection
        already_exists = target_collection.find_one(doc["_id"])

        # If the document does not exist in the target collection, insert it
        if not already_exists:
            target_collection.insert_one(doc)
