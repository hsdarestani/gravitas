"""Live Research Intelligence radar for Core members inside Research.

The endpoint intentionally has no database seed/demo fallback. It reads public,
authoritative sources, normalises them into a small UI contract, and degrades
per-source: one upstream outage never blanks the whole radar.
"""

from __future__ import annotations

import html
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

import requests
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import ResearchIntelligenceSavedItem
from .research_intelligence_history import archived_funding_payload, history_payload, persist_payload, run_status_payload


logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 30 * 60
REQUEST_TIMEOUT = (3.5, 8)
USER_AGENT = "Gravitas-Research-Radar/1.0 (+https://gravitasplus.com/)"

GRANTS_SEARCH = "https://api.grants.gov/v1/api/search2"
GRANTS_DETAIL = "https://api.grants.gov/v1/api/fetchOpportunity"
ARXIV_QUERY = "https://export.arxiv.org/api/query"
GITHUB_SEARCH = "https://api.github.com/search/repositories"
EU_SEARCH = "https://api.tech.ec.europa.eu/search-api/prod/rest/search"
UKRI_FEED = "https://www.ukri.org/opportunity/feed/"
OFFICIAL_FEEDS = (
    ("OpenAI", "https://openai.com/news/rss.xml"),
    ("Hugging Face", "https://huggingface.co/blog/feed.xml"),
)

_CACHE = {"at": 0.0, "payload": None}
_CACHE_LOCK = threading.Lock()

SPACE_RE = re.compile(r"\s+")
TAG_RE = re.compile(r"<[^>]+>")
TEMPLATE_RE = re.compile(
    r"(template|proposal|application|form|budget|work\s*plan|instructions?|narrative)",
    re.IGNORECASE,
)
RELEVANCE_TERMS = (
    "research", "researcher", "science", "scientific", "education", "learning",
    "teacher", "student", "academic", "paper", "literature", "citation",
    "evaluation", "benchmark", "reasoning", "agent", "dataset", "knowledge",
)
AI_TERMS = (
    "artificial intelligence", " ai ", "llm", "large language model", "agent",
    "machine learning", "generative", "transformer", "language model",
)


FUNDING_RELEVANCE_DEFAULT_WEIGHTS = {
    "topic": 45,
    "ai": 35,
    "deadline": 20,
}


def _valid_iso_day(value):
    value = _text(value)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def _deadline_details(close_date):
    deadline = _valid_iso_day(close_date)
    if deadline is None:
        return False, None, 20
    today = datetime.now(timezone.utc).date()
    days = (deadline - today).days
    if days < 0:
        return True, days, 0
    if days <= 30:
        urgency = 100
    elif days <= 90:
        urgency = 80
    elif days <= 180:
        urgency = 55
    else:
        urgency = 30
    return False, days, urgency


def _classify_applicant_scope(*parts):
    text = " ".join(_text(part).lower() for part in parts if part)
    scopes = []
    individual_terms = (
        "individual", "researcher", "scientist", "investigator", "fellow",
        "fellowship", "doctoral", "postdoctoral", "postdoc",
    )
    team_terms = (
        "team", "consortium", "collaborative", "partnership", "joint call",
        "multi-institution", "multidisciplinary",
    )
    organisation_terms = (
        "organisation", "organization", "institution", "university", "college",
        "company", "business", "nonprofit", "non-profit", "agency", "charity",
        "research organisation", "research organization",
    )
    if any(term in text for term in individual_terms):
        scopes.append("individual")
    if any(term in text for term in team_terms):
        scopes.append("team")
    if any(term in text for term in organisation_terms):
        scopes.append("company_institution")
    return scopes or ["unspecified"]


def _funding_relevance(item):
    title = _text(item.get("title")).lower()
    summary = _text(item.get("summary")).lower()
    categories = " ".join(_text(value).lower() for value in item.get("categories") or [])
    eligibility = " ".join(_text(value).lower() for value in item.get("eligibility") or [])
    haystack = f" {title} {summary} {categories} {eligibility} "

    topic_hits = sum(1 for term in RELEVANCE_TERMS if term in haystack)
    ai_hits = sum(1 for term in AI_TERMS if term in haystack)
    topic = min(100, 18 + topic_hits * 10)
    ai = min(100, ai_hits * 24)
    archived, days_to_deadline, deadline = _deadline_details(item.get("close_date"))

    factors = {
        "topic": topic,
        "ai": ai,
        "deadline": deadline,
    }
    weights = FUNDING_RELEVANCE_DEFAULT_WEIGHTS
    total_weight = sum(weights.values()) or 1
    score = round(sum(factors[name] * weights[name] for name in factors) / total_weight)
    return min(100, max(0, score)), factors, archived, days_to_deadline


def _funding_metadata(item, *, geography_scope, geographies, region):
    score, factors, archived, days_to_deadline = _funding_relevance(item)
    eligibility = item.get("eligibility") or []
    return {
        "relevance": score,
        "relevance_factors": factors,
        "relevance_weights": FUNDING_RELEVANCE_DEFAULT_WEIGHTS,
        "applicant_scope": _classify_applicant_scope(
            item.get("title"),
            item.get("summary"),
            " ".join(eligibility),
            " ".join(item.get("categories") or []),
        ),
        "geography_scope": geography_scope,
        "geographies": list(geographies),
        "region": region,
        "archived": archived,
        "days_to_deadline": days_to_deadline,
    }


def _match_text(pattern, value, flags=re.IGNORECASE):
    match = re.search(pattern, value or "", flags)
    return _text(match.group(1)) if match else ""


def _ukri_funding_calls():
    """Open and upcoming UKRI opportunities from the official Funding Finder RSS feed."""
    session = _session()
    response = session.get(UKRI_FEED, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)

    items = []
    errors = []
    feed_items = root.findall(".//item")[:24]
    for node in feed_items:
        title = _text(node.findtext("title"), 220)
        summary = _text(node.findtext("description"), 360)
        link = _text(node.findtext("link"))
        if not title or not link:
            continue

        preliminary = _score(title, summary)
        if preliminary < 43:
            continue

        detail_text = ""
        try:
            detail_response = session.get(link, timeout=REQUEST_TIMEOUT)
            detail_response.raise_for_status()
            detail_text = _text(detail_response.text)
        except Exception as exc:
            errors.append(_source_error("UKRI detail", exc))

        status = _match_text(r"Opportunity status:\s*(Open|Upcoming|Closed)", detail_text)
        open_raw = _match_text(r"Opening date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})", detail_text)
        close_raw = _match_text(r"Closing date:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})", detail_text)
        funder = _match_text(
            r"Funders:\s*(.{1,180}?)\s+(?:Co-funders:|Funding type:|Total fund:|Maximum award:|Award range:|Publication date:)",
            detail_text,
        )
        funding_type = _match_text(r"Funding type:\s*([A-Za-z][A-Za-z /&-]{1,80})\s+(?:Total fund:|Maximum award:|Minimum award:|Award range:|Publication date:)", detail_text)
        max_award = _match_text(r"Maximum award:\s*([£€$][0-9,]+)", detail_text)
        award_range = _match_text(r"Award range:\s*([£€$][0-9,]+\s*(?:-|to)\s*[£€$]?[0-9,]+)", detail_text)
        eligibility_text = _match_text(r"(You must[^.]{0,320}\.)", detail_text)
        if not eligibility_text:
            eligibility_text = _match_text(r"(Applicants? must[^.]{0,320}\.)", detail_text)

        identifier = link.rstrip("/").rsplit("/", 1)[-1]
        item = {
            "id": f"ukri:{identifier}",
            "kind": "funding",
            "source": "UKRI Funding Finder",
            "title": title,
            "summary": summary,
            "agency": funder or "UK Research and Innovation",
            "status": status or "open",
            "open_date": _iso_date(open_raw or node.findtext("pubDate")),
            "close_date": _iso_date(close_raw),
            "opportunity_number": identifier,
            "award_ceiling": max_award or award_range,
            "award_floor": "",
            "eligibility": [eligibility_text] if eligibility_text else [],
            "categories": [value for value in ("UKRI", funding_type) if value],
            "template_available": False,
            "template_names": [],
            "attachment_count": 0,
            "url": link,
            "relevance": preliminary,
        }
        item.update(
            _funding_metadata(
                item,
                geography_scope="country",
                geographies=["United Kingdom"],
                region="Europe",
            )
        )
        items.append(item)

    items.sort(
        key=lambda item: (
            item.get("archived", False),
            item.get("close_date") in ("", None),
            item.get("close_date") or "9999-99-99",
            -int(item.get("relevance") or 0),
        )
    )
    return items[:10], errors


def _session():
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        }
    )
    return session


def _text(value, limit=0):
    if value is None:
        return ""
    cleaned = html.unescape(TAG_RE.sub(" ", str(value)))
    cleaned = SPACE_RE.sub(" ", cleaned).strip()
    if limit and len(cleaned) > limit:
        return cleaned[: max(0, limit - 1)].rstrip() + "…"
    return cleaned


def _iso_date(value):
    """Best-effort source date -> ISO date, preserving unknown source text."""
    value = _text(value)
    if not value:
        return ""
    for candidate in (
        value,
        value.replace("Z", "+00:00"),
    ):
        try:
            return datetime.fromisoformat(candidate).date().isoformat()
        except (TypeError, ValueError):
            pass
    for fmt in (
        "%b %d, %Y %I:%M:%S %p %Z",
        "%b %d, %Y %I:%M:%S %p",
        "%m/%d/%Y",
        "%Y-%m-%d-%H-%M-%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        return value


def _money(value):
    if value in (None, ""):
        return ""
    raw = str(value).replace(",", "").replace("$", "").strip()
    try:
        number = float(raw)
    except ValueError:
        return _text(value)
    if number <= 0:
        return ""
    return f"${number:,.0f}"


def _score(*parts):
    haystack = f" {' '.join(_text(part).lower() for part in parts)} "
    score = 0
    for term in RELEVANCE_TERMS:
        if term in haystack:
            score += 2
    for term in AI_TERMS:
        if term in haystack:
            score += 3
    return min(100, 35 + score * 4)


def _source_error(source, exc):
    logger.info("research_intelligence source=%s unavailable: %s", source, exc)
    return {"source": source, "error": "source_unavailable"}


def _grants_search(session, keyword, rows=8):
    response = session.post(
        GRANTS_SEARCH,
        json={"keyword": keyword, "rows": rows, "oppStatuses": "forecasted|posted"},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data") or {}
    hits = (
        data.get("oppHits")
        or data.get("opportunities")
        or data.get("results")
        or payload.get("oppHits")
        or payload.get("opportunities")
        or []
    )
    return hits if isinstance(hits, list) else []


def _grant_id(item):
    return item.get("id") or item.get("opportunityId") or item.get("opportunity_id")


def _grant_detail(session, opportunity_id):
    response = session.post(
        GRANTS_DETAIL,
        json={"opportunityId": opportunity_id},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return (response.json().get("data") or {})


def _funding_calls():
    session = _session()
    errors = []
    raw = {}
    for keyword in (
        "artificial intelligence research",
        "education research",
        "learning science artificial intelligence",
    ):
        try:
            for item in _grants_search(session, keyword):
                identifier = _grant_id(item)
                if identifier:
                    raw[str(identifier)] = item
        except Exception as exc:  # one query may fail while the others work
            errors.append(_source_error(f"Grants.gov · {keyword}", exc))

    # Detail calls are deliberately capped; they are the only place where
    # attachment/template metadata lives and should not turn one dashboard
    # visit into dozens of upstream requests.
    candidates = list(raw.values())[:10]
    detailed = {}
    if candidates:
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {
                pool.submit(_grant_detail, session, _grant_id(item)): str(_grant_id(item))
                for item in candidates
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    detailed[key] = future.result()
                except Exception as exc:
                    errors.append(_source_error("Grants.gov detail", exc))

    items = []
    for hit in candidates:
        identifier = str(_grant_id(hit))
        detail = detailed.get(identifier, {})
        synopsis = detail.get("synopsis") or {}
        title = (
            detail.get("opportunityTitle")
            or hit.get("title")
            or hit.get("opportunityTitle")
            or "Untitled funding opportunity"
        )
        agency = (
            synopsis.get("agencyName")
            or (detail.get("agencyDetails") or {}).get("agencyName")
            or hit.get("agency")
            or hit.get("agencyName")
            or hit.get("agencyCode")
            or ""
        )
        attachments = []
        for folder in detail.get("synopsisAttachmentFolders") or []:
            for attachment in folder.get("synopsisAttachments") or []:
                name = _text(attachment.get("fileName") or attachment.get("fileDescription"))
                if name:
                    attachments.append(name)
        templates = [name for name in attachments if TEMPLATE_RE.search(name)]
        applicant_types = [
            _text(item.get("description"))
            for item in (synopsis.get("applicantTypes") or [])
            if _text(item.get("description"))
        ]
        categories = [
            _text(item.get("description"))
            for item in (synopsis.get("fundingActivityCategories") or [])
            if _text(item.get("description"))
        ]
        close_date = (
            hit.get("closeDate")
            or hit.get("close_date")
            or synopsis.get("responseDate")
            or synopsis.get("responseDateDesc")
            or ""
        )
        status = _text(
            hit.get("oppStatus")
            or hit.get("status")
            or ("posted" if synopsis else "")
        )
        summary = _text(
            synopsis.get("synopsisDesc")
            or hit.get("description")
            or hit.get("synopsis")
            or "",
            360,
        )
        items.append(
            {
                "id": identifier,
                "kind": "funding",
                "source": "Grants.gov",
                "title": _text(title, 220),
                "summary": summary,
                "agency": _text(agency, 140),
                "status": status,
                "open_date": _iso_date(hit.get("openDate") or synopsis.get("postingDate") or synopsis.get("postingDateStr")),
                "close_date": _iso_date(close_date),
                "opportunity_number": _text(detail.get("opportunityNumber") or hit.get("number") or hit.get("opportunityNumber")),
                "award_ceiling": _money(synopsis.get("awardCeilingFormatted") or synopsis.get("awardCeiling")),
                "award_floor": _money(synopsis.get("awardFloorFormatted") or synopsis.get("awardFloor")),
                "eligibility": applicant_types[:4],
                "categories": categories[:4],
                "template_available": bool(templates),
                "template_names": templates[:5],
                "attachment_count": len(attachments),
                "url": f"https://www.grants.gov/search-results-detail/{identifier}",
                "relevance": _score(title, summary, " ".join(categories)),
            }
        )

    for item in items:
        item.update(
            _funding_metadata(
                item,
                geography_scope="country",
                geographies=["United States"],
                region="North America",
            )
        )

    items.sort(key=lambda item: (item["archived"], item["close_date"] in ("", None), item["close_date"] or "9999-99-99", -item["relevance"]))
    return items[:10], errors


def _eu_value(metadata, key):
    value = (metadata or {}).get(key)
    if isinstance(value, list):
        return value[0] if value else ""
    return value or ""


def _eu_funding_calls():
    """Open/forthcoming EU grant topics from the official Funding & Tenders API."""
    session = _session()
    query = {
        "bool": {
            "must": [
                {"terms": {"type": ["1"]}},
                {"terms": {"status": ["31094501", "31094502"]}},
            ]
        }
    }
    display_fields = [
        "type", "identifier", "reference", "title", "status", "caName",
        "callTitle", "startDate", "deadlineDate", "frameworkProgramme",
        "typesOfAction", "descriptionByte",
    ]
    multipart = {
        "query": (None, json.dumps(query), "application/json"),
        "sort": (None, json.dumps({"order": "ASC", "field": "deadlineDate"}), "application/json"),
        "languages": (None, json.dumps(["en"]), "application/json"),
        "displayFields": (None, json.dumps(display_fields), "application/json"),
    }
    response = session.post(
        EU_SEARCH,
        params={
            "apiKey": "SEDIA",
            "text": "artificial intelligence research education",
            "pageSize": 30,
            "pageNumber": 1,
        },
        files=multipart,
        timeout=REQUEST_TIMEOUT,
        headers={
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://ec.europa.eu",
            "Referer": "https://ec.europa.eu/info/funding-tenders/opportunities/portal/",
        },
    )
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results") or payload.get("result") or []
    if isinstance(results, dict):
        results = results.get("results") or results.get("documents") or results.get("items") or []

    status_labels = {"31094501": "forthcoming", "31094502": "open", "31094503": "closed"}
    today = datetime.now(timezone.utc).date().isoformat()
    items = []
    for row in results if isinstance(results, list) else []:
        metadata = row.get("metadata") or row
        identifier = _text(_eu_value(metadata, "identifier") or _eu_value(metadata, "reference"))
        title = _text(_eu_value(metadata, "title") or _eu_value(metadata, "callTitle"), 220)
        if not identifier or not title:
            continue
        summary = _text(_eu_value(metadata, "descriptionByte"), 360)
        relevance = _score(title, summary, identifier)
        if relevance < 43:
            continue
        deadline = _iso_date(_eu_value(metadata, "deadlineDate"))
        if deadline and re.fullmatch(r"\d{4}-\d{2}-\d{2}", deadline) and deadline < today:
            continue
        raw_status = _text(_eu_value(metadata, "status"))
        status = status_labels.get(raw_status, raw_status)
        framework = _text(_eu_value(metadata, "frameworkProgramme"))
        action = _text(_eu_value(metadata, "typesOfAction"))
        call_title = _text(_eu_value(metadata, "callTitle"))
        categories = [value for value in (framework, action, call_title) if value]

        items.append(
            {
                "id": f"eu:{identifier}",
                "kind": "funding",
                "source": "EU Funding & Tenders",
                "title": title,
                "summary": summary,
                "agency": "European Commission",
                "status": status,
                "open_date": _iso_date(_eu_value(metadata, "startDate")),
                "close_date": deadline,
                "opportunity_number": identifier,
                "award_ceiling": "",
                "award_floor": "",
                "eligibility": [],
                "categories": categories[:4],
                "template_available": False,
                "template_names": [],
                "attachment_count": 0,
                "url": f"https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/{identifier}",
                "relevance": relevance,
            }
        )

    for item in items:
        item.update(
            _funding_metadata(
                item,
                geography_scope="continent",
                geographies=["Europe"],
                region="Europe",
            )
        )

    items.sort(key=lambda item: (item["archived"], item["close_date"] in ("", None), item["close_date"] or "9999-99-99", -item["relevance"]))
    return items[:10]


def _arxiv_papers():
    session = _session()
    params = {
        "search_query": 'all:"artificial intelligence" AND (all:research OR all:education OR all:learning)',
        "start": 0,
        "max_results": 12,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    response = session.get(ARXIV_QUERY, params=params, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items = []
    for entry in root.findall("atom:entry", ns):
        title = _text(entry.findtext("atom:title", default="", namespaces=ns), 220)
        summary = _text(entry.findtext("atom:summary", default="", namespaces=ns), 360)
        authors = [
            _text(author.findtext("atom:name", default="", namespaces=ns))
            for author in entry.findall("atom:author", ns)
        ]
        link = ""
        for node in entry.findall("atom:link", ns):
            if node.attrib.get("rel") == "alternate":
                link = node.attrib.get("href", "")
                break
        if not link:
            link = _text(entry.findtext("atom:id", default="", namespaces=ns))
        categories = [node.attrib.get("term", "") for node in entry.findall("atom:category", ns)]
        items.append(
            {
                "id": _text(entry.findtext("atom:id", default="", namespaces=ns)).rsplit("/", 1)[-1],
                "kind": "paper",
                "source": "arXiv",
                "title": title,
                "summary": summary,
                "authors": authors[:4],
                "date": _iso_date(entry.findtext("atom:published", default="", namespaces=ns)),
                "updated_at": _iso_date(entry.findtext("atom:updated", default="", namespaces=ns)),
                "categories": categories[:4],
                "url": link,
                "relevance": _score(title, summary),
            }
        )
    return items[:10]


def _github_tools():
    session = _session()
    repositories = {}
    errors = []
    queries = (
        '"ai research" in:name,description,readme fork:false archived:false',
        '"ai education" in:name,description,readme fork:false archived:false',
        '"research agent" in:name,description,readme fork:false archived:false',
    )
    for query in queries:
        try:
            response = session.get(
                GITHUB_SEARCH,
                params={"q": query, "sort": "updated", "order": "desc", "per_page": 6},
                timeout=REQUEST_TIMEOUT,
                headers={"Accept": "application/vnd.github+json"},
            )
            response.raise_for_status()
            for repo in response.json().get("items") or []:
                repositories[repo.get("full_name") or str(repo.get("id"))] = repo
        except Exception as exc:
            errors.append(_source_error("GitHub", exc))
            break

    items = []
    for repo in repositories.values():
        title = _text(repo.get("full_name") or repo.get("name"), 160)
        summary = _text(repo.get("description"), 300)
        relevance = _score(title, summary, " ".join(repo.get("topics") or []))
        if relevance < 43:
            continue
        items.append(
            {
                "id": str(repo.get("id") or title),
                "kind": "tool",
                "source": "GitHub",
                "title": title,
                "summary": summary,
                "language": _text(repo.get("language")),
                "stars": int(repo.get("stargazers_count") or 0),
                "date": _iso_date(repo.get("pushed_at") or repo.get("updated_at")),
                "topics": (repo.get("topics") or [])[:5],
                "url": repo.get("html_url") or "",
                "relevance": relevance,
            }
        )
    items.sort(key=lambda item: (-item["relevance"], -item["stars"], item["title"].lower()))
    return items[:10], errors


def _feed_entries(source, url):
    session = _session()
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)

    entries = []
    # RSS 2.x
    for item in root.findall(".//item"):
        title = _text(item.findtext("title"), 220)
        summary = _text(item.findtext("description") or item.findtext("content"), 360)
        link = _text(item.findtext("link"))
        date = _iso_date(item.findtext("pubDate") or item.findtext("date"))
        entries.append((title, summary, link, date))

    # Atom
    if not entries:
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for item in root.findall("atom:entry", ns):
            title = _text(item.findtext("atom:title", default="", namespaces=ns), 220)
            summary = _text(
                item.findtext("atom:summary", default="", namespaces=ns)
                or item.findtext("atom:content", default="", namespaces=ns),
                360,
            )
            link = ""
            for node in item.findall("atom:link", ns):
                href = node.attrib.get("href")
                if href and node.attrib.get("rel", "alternate") == "alternate":
                    link = href
                    break
            date = _iso_date(
                item.findtext("atom:published", default="", namespaces=ns)
                or item.findtext("atom:updated", default="", namespaces=ns)
            )
            entries.append((title, summary, link, date))

    out = []
    for index, (title, summary, link, date) in enumerate(entries):
        relevance = _score(title, summary)
        lower = f" {title.lower()} {summary.lower()} "
        has_research_context = any(term in lower for term in RELEVANCE_TERMS)
        if not has_research_context:
            continue
        out.append(
            {
                "id": f"{source.lower().replace(' ', '-')}-{index}-{date}",
                "kind": "development",
                "source": source,
                "title": title,
                "summary": summary,
                "date": date,
                "url": link,
                "relevance": relevance,
            }
        )
    return out[:10]


def _developments():
    items = []
    errors = []
    with ThreadPoolExecutor(max_workers=len(OFFICIAL_FEEDS)) as pool:
        futures = {pool.submit(_feed_entries, source, url): source for source, url in OFFICIAL_FEEDS}
        for future in as_completed(futures):
            source = futures[future]
            try:
                items.extend(future.result())
            except Exception as exc:
                errors.append(_source_error(source, exc))
    items.sort(key=lambda item: (item.get("date") or "", item.get("relevance") or 0), reverse=True)
    return items[:12], errors


def _build_payload():
    errors = []
    funding_us = []
    funding_eu = []
    funding_uk = []
    papers = []
    tools = []
    developments = []

    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {
            pool.submit(_funding_calls): "funding_us",
            pool.submit(_eu_funding_calls): "funding_eu",
            pool.submit(_ukri_funding_calls): "funding_uk",
            pool.submit(_arxiv_papers): "papers",
            pool.submit(_github_tools): "tools",
            pool.submit(_developments): "developments",
        }
        for future in as_completed(jobs):
            kind = jobs[future]
            try:
                result = future.result()
                if kind == "funding_us":
                    funding_us, source_errors = result
                    errors.extend(source_errors)
                elif kind == "funding_eu":
                    funding_eu = result
                elif kind == "funding_uk":
                    funding_uk, source_errors = result
                    errors.extend(source_errors)
                elif kind == "papers":
                    papers = result
                elif kind == "tools":
                    tools, source_errors = result
                    errors.extend(source_errors)
                else:
                    developments, source_errors = result
                    errors.extend(source_errors)
            except Exception as exc:
                errors.append(_source_error(kind, exc))

    funding = [*funding_eu, *funding_uk, *funding_us]
    funding.sort(
        key=lambda item: (
            item.get("close_date") in ("", None),
            item.get("close_date") or "9999-99-99",
            -int(item.get("relevance") or 0),
        )
    )
    funding = funding[:16]

    papers_tools = [*papers, *tools]
    papers_tools.sort(
        key=lambda item: (item.get("date") or item.get("updated_at") or "", item.get("relevance") or 0),
        reverse=True,
    )

    return {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "refresh_seconds": CACHE_TTL_SECONDS,
        "funding": funding,
        "papers_tools": papers_tools[:18],
        "developments": developments,
        "sources": {
            "funding": ["EU Funding & Tenders", "UKRI Funding Finder", "Grants.gov"],
            "papers_tools": ["arXiv", "GitHub"],
            "developments": [source for source, _url in OFFICIAL_FEEDS],
        },
        "errors": errors,
    }


def _with_history(payload):
    try:
        history = history_payload(60)
        funding_archive = archived_funding_payload(120)
        automation = run_status_payload()
    except Exception as exc:
        logger.warning("research_intelligence history unavailable: %s", exc)
        history = []
        funding_archive = []
        automation = {}
    return {
        **payload,
        "history": history,
        "funding_archive": funding_archive,
        "automation": {
            "enabled": True,
            "interval_seconds": CACHE_TTL_SECONDS,
            **automation,
        },
    }


@require_http_methods(["GET"])
def research_intelligence(request):
    force = request.GET.get("refresh") == "1"
    now = time.monotonic()

    with _CACHE_LOCK:
        cached = _CACHE["payload"]
        fresh = cached is not None and (now - _CACHE["at"]) < CACHE_TTL_SECONDS
        if fresh and not force:
            return JsonResponse({**_with_history(cached), "cached": True})

    payload = _build_payload()
    try:
        persist_payload(payload)
    except Exception:
        # History storage must never take the live radar down. Deployment
        # migrations and the background collector make persistence durable,
        # while this path keeps source visibility resilient.
        logger.exception("research_intelligence persistence failed")

    with _CACHE_LOCK:
        _CACHE["payload"] = payload
        _CACHE["at"] = time.monotonic()

    return JsonResponse({**_with_history(payload), "cached": False})



def _saved_item_key(item):
    source = _text((item or {}).get("source"))
    external_id = _text((item or {}).get("id"))
    url = _text((item or {}).get("url"))
    return f"{source}|{external_id or url}"[:400]


@require_http_methods(["GET", "POST", "DELETE"])
def research_intelligence_saved(request):
    if request.method == "GET":
        rows = ResearchIntelligenceSavedItem.objects.filter(user=request.user).order_by("-updated_at")
        return JsonResponse({
            "saved_keys": [row.item_key for row in rows],
            "items": [row.snapshot for row in rows if isinstance(row.snapshot, dict)],
        })

    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "invalid_json"}, status=400)

    item = body.get("item") if isinstance(body, dict) else None
    key = _text(body.get("key") if isinstance(body, dict) else "")
    if not key and isinstance(item, dict):
        key = _saved_item_key(item)
    key = key[:400]
    if not key:
        return JsonResponse({"error": "item_key_required"}, status=400)

    if request.method == "DELETE":
        ResearchIntelligenceSavedItem.objects.filter(user=request.user, item_key=key).delete()
        return JsonResponse({"ok": True, "saved": False, "key": key})

    if not isinstance(item, dict):
        return JsonResponse({"error": "item_required"}, status=400)

    row, _created = ResearchIntelligenceSavedItem.objects.update_or_create(
        user=request.user,
        item_key=key,
        defaults={"snapshot": item},
    )
    return JsonResponse({"ok": True, "saved": True, "key": row.item_key})
