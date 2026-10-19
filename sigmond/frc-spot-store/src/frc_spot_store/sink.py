"""
Read-only tail of sigmond's shared sink (/var/lib/sigmond/sink.db).

The sink is a SQLite WAL database with one table, ``pending_uploads``.
Producers append rows; hs-uploader reads them with its own cursor
(``delete_on_commit = false``) and ``smd admin storage trim`` deletes rows
by age.  We are just another reader: we remember the highest ``id`` we have
stored and ask for rows above it.  ``id`` is AUTOINCREMENT and SQLite has a
single writer, so a visible id N means every committed id < N is visible.
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from typing import Optional

SPOT_TARGETS = ('wspr', 'psk')


@dataclass
class SinkRow:
    id: int
    target_db: str
    payload: Optional[dict]


class SinkReader:
    def __init__(self, path: str):
        self.path = path
        self._conn: Optional[sqlite3.Connection] = None
        self._ino: Optional[int] = None

    def _connect(self) -> sqlite3.Connection:
        # If the sink file was replaced (rebuilt/restored), an open handle
        # would keep reading the old unlinked inode forever: reopen.
        try:
            ino = os.stat(self.path).st_ino
        except OSError:
            ino = None
        if self._conn is not None and ino != self._ino:
            self.close()
        if self._conn is None:
            self._ino = ino
            # mode=ro: never write the sink.  WAL readers still need the
            # -shm sidecar, which is group-writable by `sigmond`.
            self._conn = sqlite3.connect(f'file:{self.path}?mode=ro', uri=True,
                                         timeout=10.0, check_same_thread=False)
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            finally:
                self._conn = None

    def _query(self, sql: str, params=()) -> list:
        try:
            return self._connect().execute(sql, params).fetchall()
        except sqlite3.Error:
            # Drop the handle so the next call reconnects (sink recreated,
            # transient lock, etc.), then let the caller see the error.
            self.close()
            raise

    # Per-target ORDER BY id LIMIT 1 rides idx_pending_uploads_target
    # (target_db, target_table, id); MIN/MAX with a WHERE would scan the table.
    def _edge(self, tdb: str, order: str) -> Optional[int]:
        row = self._query(
            'SELECT id FROM pending_uploads WHERE target_db = ? '
            f"AND target_table = 'spots' ORDER BY id {order} LIMIT 1", (tdb,))
        return row[0][0] if row else None

    def id_bounds(self) -> tuple[int, int]:
        """(min id, max id) over spot rows; (0, 0) when empty."""
        lo = [v for t in SPOT_TARGETS if (v := self._edge(t, 'ASC')) is not None]
        hi = [v for t in SPOT_TARGETS if (v := self._edge(t, 'DESC')) is not None]
        return (min(lo) if lo else 0, max(hi) if hi else 0)

    def table_max_id(self) -> int:
        """Highest id of any row (rowid max: O(1)); 0 when empty."""
        return self._query('SELECT MAX(id) FROM pending_uploads')[0][0] or 0

    def min_ids(self) -> dict[str, int]:
        """Oldest surviving spot row id per target_db (trim is per-target)."""
        return {t: v for t in SPOT_TARGETS if (v := self._edge(t, 'ASC')) is not None}

    def fetch(self, after_id: int, limit: int) -> list[SinkRow]:
        rows = self._query(
            'SELECT id, target_db, payload_json FROM pending_uploads '
            "WHERE id > ? AND target_table = 'spots' AND target_db IN (?, ?) "
            'ORDER BY id LIMIT ?',
            (after_id, *SPOT_TARGETS, limit))
        out = []
        for rid, tdb, pj in rows:
            try:
                payload = json.loads(pj)
            except (TypeError, ValueError):
                payload = None
            out.append(SinkRow(rid, tdb, payload))
        return out
