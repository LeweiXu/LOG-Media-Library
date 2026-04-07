from __future__ import annotations

import logging
from typing import Optional

import httpx

from config import get_settings
from schemas import SearchResult

logger = logging.getLogger(__name__)
settings = get_settings()

TIMEOUT = httpx.Timeout(10.0)

_COUNTRY_TO_ORIGIN: dict[str, str] = {
    "JP": "Japanese",
    "KR": "Korean",
    "CN": "Chinese",
    "TW": "Chinese",
    "HK": "Chinese",
    "US": "Western",
    "GB": "Western",
    "FR": "Western",
    "DE": "Western",
    "AU": "Western",
    "CA": "Western",
}


def country_to_origin(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return _COUNTRY_TO_ORIGIN.get(code.upper(), "Other")


def safe_year(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        return int(str(date_str)[:4])
    except (ValueError, TypeError):
        return None
