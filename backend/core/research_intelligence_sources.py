"""Per-user source configuration for Research Intelligence.

Built-in source definitions are curated and safe. Users may also add public
HTTPS RSS/Atom feeds. Custom feed URLs are validated against local/private
network targets before they are persisted or fetched.
"""

from __future__ import annotations

import hashlib
import ipaddress
import socket
from urllib.parse import urlparse

from .models import ResearchIntelligenceSourceProfile


DFG_FUNDING_FEED = "https://www.dfg.de/service/rss/de/323556/feed.rss"

BUILTIN_SOURCE_CATALOG = (
    {
        "id": "eu_funding",
        "name": "EU Funding & Tenders",
        "kind": "funding",
        "region": "Europe",
        "default_enabled": True,
        "description": "European Commission research and innovation funding calls.",
    },
    {
        "id": "ukri_funding",
        "name": "UKRI Funding Finder",
        "kind": "funding",
        "region": "Europe",
        "default_enabled": True,
        "description": "UK Research and Innovation funding opportunities.",
    },
    {
        "id": "dfg_funding",
        "name": "DFG Funding Calls",
        "kind": "funding",
        "region": "Germany",
        "default_enabled": True,
        "description": "DFG calls and funding-relevant announcements from its official RSS feed.",
    },
    {
        "id": "grants_gov",
        "name": "Grants.gov",
        "kind": "funding",
        "region": "United States",
        "default_enabled": False,
        "description": "US federal funding opportunities. Off by default for new profiles.",
    },
    {
        "id": "arxiv",
        "name": "arXiv",
        "kind": "papers_tools",
        "region": "International",
        "default_enabled": True,
        "description": "Recent papers matching the Research Intelligence topic model.",
    },
    {
        "id": "github",
        "name": "GitHub",
        "kind": "papers_tools",
        "region": "International",
        "default_enabled": True,
        "description": "Recently updated research and education tooling repositories.",
    },
    {
        "id": "openai_news",
        "name": "OpenAI",
        "kind": "developments",
        "region": "International",
        "default_enabled": True,
        "description": "Official OpenAI news feed.",
    },
    {
        "id": "huggingface_blog",
        "name": "Hugging Face",
        "kind": "developments",
        "region": "International",
        "default_enabled": True,
        "description": "Official Hugging Face blog feed.",
    },
)

BUILTIN_SOURCE_IDS = {item["id"] for item in BUILTIN_SOURCE_CATALOG}
DEFAULT_SOURCE_IDS = tuple(
    item["id"] for item in BUILTIN_SOURCE_CATALOG if item["default_enabled"]
)
CUSTOM_SOURCE_KINDS = {"funding", "developments"}
MAX_CUSTOM_SOURCES = 12


def source_catalog_payload():
    return [dict(item) for item in BUILTIN_SOURCE_CATALOG]


def _is_public_ip(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return bool(address.is_global)


def validate_public_https_url(value):
    raw = str(value or "").strip()
    if len(raw) > 1000:
        raise ValueError("source_url_too_long")
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise ValueError("source_url_https_required")
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("source_url_invalid")
    if parsed.port not in (None, 443):
        raise ValueError("source_url_port_not_allowed")

    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        raise ValueError("source_url_private_host")

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not literal.is_global:
            raise ValueError("source_url_private_host")
        return raw

    try:
        resolved = {
            row[4][0]
            for row in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            if row and row[4]
        }
    except OSError as exc:
        raise ValueError("source_url_unresolvable") from exc
    if not resolved or any(not _is_public_ip(address) for address in resolved):
        raise ValueError("source_url_private_host")
    return raw


def _normalise_custom_source(item):
    if not isinstance(item, dict):
        raise ValueError("custom_source_invalid")
    name = " ".join(str(item.get("name") or "").split()).strip()[:120]
    kind = str(item.get("kind") or "").strip()
    if not name:
        raise ValueError("custom_source_name_required")
    if kind not in CUSTOM_SOURCE_KINDS:
        raise ValueError("custom_source_kind_invalid")
    url = validate_public_https_url(item.get("url"))
    source_id = str(item.get("id") or "").strip()
    if not source_id.startswith("custom:"):
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
        source_id = f"custom:{digest}"
    return {
        "id": source_id[:80],
        "name": name,
        "url": url,
        "kind": kind,
        "region": "Custom",
    }


def sanitise_source_profile(enabled_sources, custom_sources):
    if not isinstance(enabled_sources, list):
        enabled_sources = list(DEFAULT_SOURCE_IDS)
    enabled = []
    for source_id in enabled_sources:
        source_id = str(source_id or "").strip()
        if source_id in BUILTIN_SOURCE_IDS and source_id not in enabled:
            enabled.append(source_id)

    custom = []
    seen_urls = set()
    if isinstance(custom_sources, list):
        for raw in custom_sources[:MAX_CUSTOM_SOURCES]:
            item = _normalise_custom_source(raw)
            if item["url"] in seen_urls:
                continue
            seen_urls.add(item["url"])
            custom.append(item)
    return enabled, custom


def get_source_profile(user, *, create=True):
    if not getattr(user, "is_authenticated", False):
        return {
            "enabled_sources": list(DEFAULT_SOURCE_IDS),
            "custom_sources": [],
        }
    defaults = {
        "enabled_sources": list(DEFAULT_SOURCE_IDS),
        "custom_sources": [],
    }
    if create:
        profile, _created = ResearchIntelligenceSourceProfile.objects.get_or_create(
            user=user,
            defaults=defaults,
        )
    else:
        profile = ResearchIntelligenceSourceProfile.objects.filter(user=user).first()
        if profile is None:
            return defaults
    enabled, custom = sanitise_source_profile(
        profile.enabled_sources,
        profile.custom_sources,
    )
    return {
        "enabled_sources": enabled,
        "custom_sources": custom,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def save_source_profile(user, body):
    if not isinstance(body, dict):
        raise ValueError("invalid_json")
    enabled, custom = sanitise_source_profile(
        body.get("enabled_sources"),
        body.get("custom_sources"),
    )
    profile, _created = ResearchIntelligenceSourceProfile.objects.update_or_create(
        user=user,
        defaults={
            "enabled_sources": enabled,
            "custom_sources": custom,
        },
    )
    return {
        "enabled_sources": enabled,
        "custom_sources": custom,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def source_profile_signature(profile):
    enabled = ",".join(sorted(profile.get("enabled_sources") or []))
    custom = "|".join(
        f'{item.get("kind")}:{item.get("name")}:{item.get("url")}'
        for item in sorted(
            profile.get("custom_sources") or [],
            key=lambda value: (value.get("kind", ""), value.get("url", "")),
        )
    )
    return hashlib.sha256(f"{enabled}||{custom}".encode("utf-8")).hexdigest()


def source_name_map(profile):
    enabled = set(profile.get("enabled_sources") or [])
    names = {
        item["id"]: item["name"]
        for item in BUILTIN_SOURCE_CATALOG
        if item["id"] in enabled
    }
    for item in profile.get("custom_sources") or []:
        names[item["id"]] = item["name"]
    return names
