"""
Create MongoDB indexes for the HamSCI Contesting Dashboard

This script creates optimized indexes on the wspr_db.spots collection to improve
query performance for time-based lookups.

Run this script once to create the indexes:
    python create_indexes.py

Author: Owen Ruzanski (KD3ALD)
Organization: University of Scranton (W3USR), Frankford Radio Club
"""

from pymongo import MongoClient, DESCENDING
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Database Configuration
MONGODB_HOST = os.getenv('MONGODB_HOST', 'localhost')
MONGODB_PORT = os.getenv('MONGODB_PORT', '27017')
MONGODB_USERNAME = os.getenv('MONGODB_USERNAME', 'admin')
MONGODB_PASSWORD = os.getenv('MONGODB_PASSWORD')
MONGODB_DATABASE = os.getenv('MONGODB_DATABASE', 'wspr_db')

if not MONGODB_PASSWORD:
    raise ValueError("MONGODB_PASSWORD environment variable is not set. Please create a .env file (see .env.example)")

# Construct MongoDB connection URI
MONGODB_URI = f"mongodb://{MONGODB_USERNAME}:{MONGODB_PASSWORD}@{MONGODB_HOST}:{MONGODB_PORT}"

print("Connecting to MongoDB...")
client = MongoClient(MONGODB_URI)
db = client[MONGODB_DATABASE]
collection = db['spots']

print(f"Connected to database: {MONGODB_DATABASE}")
print(f"Collection: spots")

# Check existing indexes
print("\nExisting indexes:")
for index in collection.list_indexes():
    print(f"  - {index['name']}: {index['key']}")

# Create compound index on (date, time) for efficient time-based queries
print("\nCreating compound index on (date, time)...")
try:
    result = collection.create_index(
        [("date", DESCENDING), ("time", DESCENDING)],
        name="date_time_idx",
        background=True  # Create in background to avoid blocking
    )
    print(f"✓ Successfully created index: {result}")
except Exception as e:
    if "already exists" in str(e):
        print("✓ Index already exists (skipping)")
    else:
        print(f"✗ Error creating index: {e}")
        raise

# Optionally create index on mode for mode-specific queries
print("\nCreating index on mode field...")
try:
    result = collection.create_index(
        [("mode", 1)],
        name="mode_idx",
        background=True
    )
    print(f"✓ Successfully created index: {result}")
except Exception as e:
    if "already exists" in str(e):
        print("✓ Index already exists (skipping)")
    else:
        print(f"✗ Error creating index: {e}")
        raise

# Display final index list
print("\nFinal indexes:")
for index in collection.list_indexes():
    print(f"  - {index['name']}: {index['key']}")

# Get collection stats
print("\nCollection statistics:")
stats = db.command("collstats", "spots")
print(f"  Document count: {stats.get('count', 'N/A'):,}")
print(f"  Storage size: {stats.get('storageSize', 0) / 1024 / 1024:.2f} MB")
print(f"  Index size: {stats.get('totalIndexSize', 0) / 1024 / 1024:.2f} MB")

print("\n✓ Index creation complete!")
print("\nExpected performance improvement:")
print("  - Time-based queries should be 10-100x faster")
print("  - Dashboard load times should decrease significantly")
print("\nYou can now run your web application with improved performance.")

client.close()
