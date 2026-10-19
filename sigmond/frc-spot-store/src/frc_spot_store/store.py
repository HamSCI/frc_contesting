"""MongoDB writer for the dashboard's ``wspr_db.spots`` collection."""

from __future__ import annotations

from pymongo import ASCENDING, MongoClient, UpdateOne
from pymongo.errors import OperationFailure

from .config import mongodb_uri


class SpotStore:
    def __init__(self, settings: dict, collection: str, retention_days: int):
        self.settings = settings
        self.client = MongoClient(mongodb_uri(settings),
                                  serverSelectionTimeoutMS=5000,
                                  connectTimeoutMS=5000,
                                  appname='frc-spot-store')
        self.coll = self.client[settings['database']][collection]
        self.retention_days = int(retention_days or 0)
        self._indexes_ok = False

    def ping(self) -> None:
        self.client.admin.command('ping')

    def ensure_indexes(self) -> None:
        if self._indexes_ok:
            return
        # The dashboard's time-window query filters/sorts on (date, time).
        self.coll.create_index([('date', ASCENDING), ('time', ASCENDING)],
                               name='date_time')
        # Idempotent re-ingest: one document per natural spot key.  sparse
        # keeps legacy storedb.py documents (no spot_key) from colliding on a
        # null key.  (Not a partial index: the planner only uses a partial
        # index when the query repeats its filter, so every upsert would
        # collection-scan.)
        info = self.coll.index_information().get('spot_key_unique')
        if info and not info.get('sparse'):
            self.coll.drop_index('spot_key_unique')
        self.coll.create_index([('spot_key', ASCENDING)], name='spot_key_unique',
                               unique=True, sparse=True)
        self._ensure_ttl()
        self._indexes_ok = True

    def _ensure_ttl(self) -> None:
        name = 'ts_ttl'
        existing = self.coll.index_information().get(name)
        if self.retention_days <= 0:
            if existing:
                self.coll.drop_index(name)
            return
        seconds = self.retention_days * 86400
        if existing is None:
            self.coll.create_index([('ts', ASCENDING)], name=name,
                                   expireAfterSeconds=seconds)
        elif existing.get('expireAfterSeconds') != seconds:
            try:
                self.coll.database.command('collMod', self.coll.name,
                                           index={'name': name,
                                                  'expireAfterSeconds': seconds})
            except OperationFailure:
                self.coll.drop_index(name)
                self.coll.create_index([('ts', ASCENDING)], name=name,
                                       expireAfterSeconds=seconds)

    def write(self, docs: list[dict]) -> int:
        """Upsert docs by spot_key (first write wins).  Returns # inserted."""
        if not docs:
            return 0
        ops = [UpdateOne({'spot_key': d['spot_key']}, {'$setOnInsert': d}, upsert=True)
               for d in docs]
        result = self.coll.bulk_write(ops, ordered=False)
        return result.upserted_count

    def count(self) -> int:
        return self.coll.estimated_document_count()

    def close(self) -> None:
        self.client.close()
