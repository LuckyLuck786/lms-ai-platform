"""Synchronous psycopg (v3) helpers for the AI service.

The AI service is internal — it receives requests proxied from the Node
backend (which enforces JWT auth and rate limits) with X-User-Id headers.
"""

from contextlib import contextmanager
from typing import Any, Iterator, List, Optional, Tuple, Union

import psycopg
from psycopg.rows import dict_row

from .config import get_settings


@contextmanager
def db_cursor() -> Iterator[psycopg.Cursor]:
    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            yield cur
            conn.commit()


def query_all(sql: str, params: Union[List[Any], Tuple] = ()) -> List[dict]:
    with db_cursor() as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def query_one(sql: str, params: Union[List[Any], Tuple] = ()) -> Optional[dict]:
    rows = query_all(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Union[List[Any], Tuple] = ()) -> Optional[dict]:
    """Runs a statement and returns the first RETURNING row, if any."""
    with db_cursor() as cur:
        cur.execute(sql, params)
        if cur.description is None:
            return None
        row = cur.fetchone()
        return dict(row) if row else None
