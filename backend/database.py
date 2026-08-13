import os

from pymongo import MongoClient
from dotenv import load_dotenv


load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

client = MongoClient(MONGO_URI)

db = client["login_app"]

users_collection = db["users"]
sessions_collection = db["sessions"]
messages_collection = db["messages"]
documents_collection = db["documents"]
query_logs_collection = db["query_logs"]
