"""Fixed-host metadata retrieval. Never follow model supplied URLs."""
import hashlib
import json
from urllib.parse import quote
import requests
from django.utils import timezone
from .scientific_lab_methods import doi, metadata_match


def fetch(url, params=None):
    started = timezone.now().isoformat()
    with requests.get(url, params=params, timeout=(5, 15), allow_redirects=False, stream=True, headers={'User-Agent': 'GraviQuest-ResearchLab/1.0', 'Accept': 'application/json'}) as response:
        if response.status_code != 200:
            raise ValueError('source_http_' + str(response.status_code))
        content = bytearray()
        for chunk in response.iter_content(32768):
            content.extend(chunk)
            if len(content) > 2_000_000:
                raise ValueError('source_response_too_large')
        return json.loads(content), {'url': response.url, 'retrieved_at': started, 'sha256': hashlib.sha256(content).hexdigest()}


def retrieve(question):
    data, provenance = fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search', {'query': question, 'format': 'json', 'pageSize': 5, 'resultType': 'core'})
    records = []
    for r in data.get('resultList', {}).get('result', [])[:5]:
        records.append({'title': r.get('title', ''), 'doi': r.get('doi', ''), 'authors': r.get('authorString', ''), 'year': r.get('pubYear', ''), 'abstract': str(r.get('abstractText', ''))[:12000], 'source_id': r.get('id', ''), 'source': r.get('source', ''), 'is_open_access': r.get('isOpenAccess', ''), 'full_text_reviewed': False})
    return {'records': records, 'provenance': provenance, 'coverage': 'Europe PMC; not a comprehensive cross-disciplinary search'}


def verify(citation):
    identifier = doi(citation.get('doi', ''))
    if not identifier:
        return {'status': 'unverifiable', 'reason': 'No valid DOI supplied. Manual title/author search required; not evidence of fabrication.', 'claim_support': 'not_assessed'}
    try:
        data, provenance = fetch('https://api.crossref.org/works/' + quote(identifier, safe=''))
        r = data['message']
        authors = r.get('author') or [{}]
        dates = r.get('published', {}).get('date-parts', [[]])
        record = {'doi': r.get('DOI', ''), 'title': (r.get('title') or [''])[0], 'first_author': authors[0].get('family', ''), 'year': str(dates[0][0]) if dates and dates[0] else '', 'journal': (r.get('container-title') or [''])[0]}
        return {**metadata_match(citation, record), 'record': record, 'provenance': provenance, 'scope': 'Crossref deposited metadata, not full text or claim support'}
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError):
        return {'status': 'unknown', 'reason': 'Registry request failed, DOI absent from registry, or response invalid. Manual verification required; never inferred fabricated.', 'claim_support': 'not_assessed'}
