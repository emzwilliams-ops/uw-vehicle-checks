import { getAppConfig } from './config.mjs';
import { ExternalServiceError, getJson, getText, postForm, postJson } from './http.mjs';
import { lookupSample } from './sample-data.mjs';

const DVLA_BASE_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';
const GOOGLE_CSE_URL = 'https://www.googleapis.com/customsearch/v1';
const SERPAPI_URL = 'https://serpapi.com/search.json';

let motTokenCache = { token: '', expiresAt: 0 };

export function normalizeRegistration(value) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!cleaned) throw new Error('Please enter a registration number.');
  return cleaned;
}

export async function buildReport(rawRegistration) {
  const registration = normalizeRegistration(rawRegistration);
  const config = getAppConfig();
  const sample = (await lookupSample(registration)) || {};
  const dataSources = [];

  const dvlaData = await safeLookup(dataSources, 'DVLA Vehicle Enquiry Service', 'Vehicle make/model/year/tax/MOT status by registration.', Boolean(config.dvlaApiKey), () => lookupDvla(registration, config));
  const motData = await safeLookup(dataSources, 'DVSA MOT history API', 'MOT history, mileage, failures, and advisories.', Boolean(config.motApiKey && config.motClientId && config.motClientSecret && config.motTokenUrl), () => lookupMot(registration, config));
  const queries = buildSearchQueries(registration, dvlaData || sample.vehicle_summary || {});
  const webSearchData = await safeLookup(dataSources, 'Open-web search provider', 'Adverts, photos, cached pages, forums, and marketplace mentions.', isSearchConfigured(config), () => runSearchQueries(queries, config));

  const vehicleSummary = buildVehicleSummary(registration, sample, dvlaData);
  const motHistory = buildMotHistory(sample, motData);
  const webFindings = buildWebFindings(registration, sample, webSearchData);
  const recalls = buildRecalls(registration, sample, webFindings);
  const researchFlags = buildResearchFlags(motHistory, recalls, webFindings);

  return {
    registration,
    vehicle_summary: vehicleSummary,
    mot_history: motHistory,
    recalls,
    web_findings: webFindings,
    research_flags: researchFlags,
    headline_flags: researchFlags.slice(0, 3).map((flag) => flag.title),
    data_sources: dataSources,
    disclaimer: 'This report is a research aid. It collects vehicle-related signals and open-source leads but does not determine liability, causation, ownership, or claim outcome.',
  };
}

export async function captureSnapshot(sourceUrl) {
  const config = getAppConfig();
  const { body, contentType } = await getText(sourceUrl, { headers: { 'User-Agent': 'UnderwritingIntelligence/1.0' }, timeoutSeconds: config.requestTimeoutSeconds });
  return { body, contentType, bodyExcerpt: truncate(stripHtml(body), 320) };
}

export function exportReportCsv(report) {
  const rows = [['section', 'title', 'detail', 'status_or_confidence', 'source_url']];
  for (const [key, value] of Object.entries(report.vehicle_summary || {})) rows.push(['vehicle_summary', key, String(value ?? ''), '', '']);
  for (const [key, value] of Object.entries(report.case_details || {})) rows.push(['case_detail', key, String(value ?? ''), '', '']);
  for (const item of report.research_flags || []) rows.push(['research_flag', item.title || '', item.detail || '', item.severity || '', '']);
  for (const item of report.mot_history || []) rows.push(['mot_history', item.date || '', (item.items || []).join(' | '), item.result || '', '']);
  for (const item of report.recalls || []) rows.push(['recall', item.title || '', item.why_it_matters || '', item.status || '', item.source_url || '']);
  for (const item of report.web_findings || []) rows.push(['web_finding', item.title || '', item.excerpt || '', item.confidence || '', item.source_url || '']);
  for (const item of report.snapshots || []) rows.push(['snapshot', item.source_title || '', item.body_excerpt || '', item.created_at || '', item.source_url || '']);
  for (const item of report.data_sources || []) rows.push(['data_source', item.name || '', item.purpose || '', item.status || '', '']);
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

async function safeLookup(statuses, name, purpose, configured, operation) {
  if (!configured) {
    statuses.push({ name, status: 'Credentials needed', purpose });
    return null;
  }
  try {
    const result = await operation();
    statuses.push({ name, status: 'Live data connected', purpose });
    return result;
  } catch (error) {
    statuses.push({ name, status: `Error: ${truncate(error.message || String(error), 96)}`, purpose });
    return null;
  }
}

async function lookupDvla(registration, config) {
  return postJson(DVLA_BASE_URL, { registrationNumber: registration }, { headers: { Accept: 'application/json', 'x-api-key': config.dvlaApiKey }, timeoutSeconds: config.requestTimeoutSeconds });
}

async function lookupMot(registration, config) {
  const token = await getMotAccessToken(config);
  const url = config.motLookupUrl.replace('{registration}', registration);
  const response = await getJson(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'X-API-Key': config.motApiKey }, timeoutSeconds: config.requestTimeoutSeconds });
  return Array.isArray(response) ? response : [response];
}

async function getMotAccessToken(config) {
  if (motTokenCache.token && Date.now() < motTokenCache.expiresAt) return motTokenCache.token;
  const tokenResponse = await postForm(config.motTokenUrl, { grant_type: 'client_credentials', client_id: config.motClientId, client_secret: config.motClientSecret, scope: config.motScope }, { timeoutSeconds: config.requestTimeoutSeconds });
  if (!tokenResponse?.access_token) throw new ExternalServiceError('MOT token response did not include access_token');
  motTokenCache = { token: tokenResponse.access_token, expiresAt: Date.now() + Math.max((Number(tokenResponse.expires_in) || 300) - 60, 60) * 1000 };
  return motTokenCache.token;
}

function isSearchConfigured(config) {
  const provider = config.webSearchProvider.toLowerCase();
  if (provider === 'google_cse') return Boolean(config.webSearchApiKey && config.webSearchEngineId);
  if (provider === 'serpapi') return Boolean(config.webSearchApiKey);
  return false;
}

async function runSearchQueries(queries, config) {
  const merged = [];
  const seen = new Set();
  for (const query of queries) {
    const items = await searchWeb(query, config);
    for (const item of items) {
      const link = extractSearchLink(item);
      if (!link || seen.has(link)) continue;
      merged.push({ query, item });
      seen.add(link);
    }
  }
  return merged;
}

async function searchWeb(query, config) {
  const provider = config.webSearchProvider.toLowerCase();
  if (provider === 'google_cse') {
    const params = new URLSearchParams({ key: config.webSearchApiKey, cx: config.webSearchEngineId, q: query, num: String(Math.min(config.webSearchMaxResults, 10)) });
    const response = await getJson(`${GOOGLE_CSE_URL}?${params.toString()}`, { timeoutSeconds: config.requestTimeoutSeconds });
    return response?.items || [];
  }
  if (provider === 'serpapi') {
    const params = new URLSearchParams({ engine: 'google', q: query, api_key: config.webSearchApiKey, num: String(config.webSearchMaxResults) });
    const response = await getJson(`${SERPAPI_URL}?${params.toString()}`, { timeoutSeconds: config.requestTimeoutSeconds });
    return response?.organic_results || [];
  }
  throw new ExternalServiceError(`Unsupported WEB_SEARCH_PROVIDER: ${config.webSearchProvider}`);
}

function buildSearchQueries(registration, vehicleSummary) {
  const base = `"${registration}"`;
  const make = String(vehicleSummary.make || '').trim();
  const model = String(vehicleSummary.model || '').trim();
  const makeModel = [make, model].filter(Boolean).join(' ');
  const queries = [base, `${base} advert OR listing OR auction OR sale`, `${base} recall OR defect OR investigation`];
  if (makeModel) queries.push(`${base} "${makeModel}"`);
  return queries.slice(0, 3);
}

function buildVehicleSummary(registration, sample, dvlaData) {
  const summary = sample.vehicle_summary || {};
  const live = dvlaData || {};
  let motStatus = live.motStatus || summary.mot_status || 'Unknown';
  if (live.motExpiryDate) motStatus = `${motStatus} until ${formatDate(live.motExpiryDate)}`;
  const notes = [];
  if (dvlaData) notes.push('Vehicle summary is coming from DVLA live data.');
  else notes.push('Add DVLA_API_KEY in Netlify environment variables to replace placeholder vehicle details with live DVLA data.');
  if (live.monthOfFirstRegistration) notes.push(`First registration recorded as ${live.monthOfFirstRegistration}.`);
  if (live.dateOfLastV5CIssued) notes.push(`Last V5C issue date: ${formatDate(live.dateOfLastV5CIssued)}.`);
  return {
    registration,
    make: titlecaseWords(live.make || summary.make || 'Not yet connected'),
    model: titlecaseWords(live.model || summary.model || 'Add DVLA vehicle enquiry'),
    colour: titlecaseWords(live.colour || summary.colour || 'Unknown'),
    fuel_type: titlecaseWords(live.fuelType || summary.fuel_type || 'Unknown'),
    year_of_manufacture: live.yearOfManufacture || summary.year_of_manufacture || 'Unknown',
    mot_status: motStatus,
    tax_status: live.taxStatus || summary.tax_status || 'Unknown',
    notes: notes.join(' '),
  };
}

function buildMotHistory(sample, motData) {
  if (motData?.length) {
    const events = motData[0]?.motTests || [];
    if (events.length) {
      return events.slice(0, 8).map((item) => ({
        date: formatDate(item.completedDate || 'Unknown'),
        result: titlecaseWords(item.testResult || 'Unknown'),
        mileage: item.odometerValue || '-',
        items: (item.rfrAndComments || []).map((defect) => `${titlecaseWords(defect.type || 'comment')}: ${defect.text || 'No detail provided'}`).concat((item.rfrAndComments || []).length ? [] : ['No defects or advisories recorded on this test entry.']),
      }));
    }
  }
  if (sample.mot_history?.length) return sample.mot_history;
  return [{ date: 'Awaiting MOT API connection', result: 'No live data', mileage: '-', items: ['Add the DVSA MOT API credentials in Netlify environment variables to pull failures, advisories, and mileage trends.'] }];
}

function buildRecalls(registration, sample, webFindings) {
  const recalls = [...(sample.recalls || [])];
  if (!recalls.length) recalls.push({ status: 'Manual check', title: 'Official recall check', why_it_matters: 'Use the GOV.UK recall journey to confirm whether safety work is outstanding for this vehicle.', source_url: 'https://www.gov.uk/check-vehicle-recall' });
  for (const item of webFindings.filter((finding) => finding.type === 'Recall').slice(0, 3)) recalls.push({ status: 'Open web signal', title: item.title, why_it_matters: item.excerpt, source_url: item.source_url });
  recalls.push({ status: 'Official follow-up', title: `Check GOV.UK services for ${registration}`, why_it_matters: 'The GOV.UK recall page links to the registration-based service and the MOT history journey for the same vehicle.', source_url: 'https://www.gov.uk/check-vehicle-recall' });
  return dedupeByKey(recalls, 'title');
}

function buildWebFindings(registration, sample, liveSearchData) {
  let findings = [...(sample.web_findings || [])];
  if (liveSearchData?.length) {
    const liveItems = [];
    for (const wrapped of liveSearchData) {
      const item = wrapped.item;
      const link = extractSearchLink(item);
      if (!link) continue;
      liveItems.push({ type: classifyFinding(item), title: extractSearchTitle(item), excerpt: extractSearchSnippet(item), source_url: link, confidence: scoreConfidence(registration, item) });
    }
    findings = dedupeByKey([...liveItems, ...findings], 'source_url');
  }
  if (findings.length) return findings.slice(0, 10);
  return [{ type: 'Search workflow', title: `No indexed open-web evidence found yet for ${registration}`, excerpt: 'Add a search provider key in Netlify environment variables to populate adverts, auction pages, cached results, and other public references automatically.', source_url: `https://www.google.com/search?q=${encodeURIComponent(`"${registration}"`)}`, confidence: 'Low' }];
}

function buildResearchFlags(motHistory, recalls, webFindings) {
  const flags = [];
  const recurring = summarizeMotTerms(motHistory);
  if (recurring) flags.push({ title: 'Recurring MOT themes', severity: 'Medium', detail: `Repeated MOT language spotted around: ${recurring}.` });
  if (recalls.some((item) => ['open', 'manual check', 'official follow-up', 'open web signal'].includes(String(item.status || '').toLowerCase()))) flags.push({ title: 'Recall follow-up required', severity: 'High', detail: 'Recall-related signals are present. Confirm whether any manufacturer remedy was outstanding at the time of loss.' });
  if (webFindings.some((item) => ['advert', 'auction', 'listing'].includes(String(item.type || '').toLowerCase()))) flags.push({ title: 'Historic listing evidence found', severity: 'Medium', detail: 'Listings can reveal prior damage, warning lights, modifications, or sale descriptions worth cross-checking.' });
  if (webFindings.some((item) => item.type === 'Photo')) flags.push({ title: 'Photo trail available', severity: 'Low', detail: 'Public image results may help compare pre-loss condition or identify prior visible damage.' });
  if (!flags.length) flags.push({ title: 'No strong flags yet', severity: 'Low', detail: 'The registration was processed, but richer signals depend on live keys and what the open web has indexed.' });
  return flags;
}

function summarizeMotTerms(motHistory) {
  const keywords = ['brake', 'tyre', 'suspension', 'steering', 'corrosion', 'light', 'airbag'];
  const found = [];
  for (const event of motHistory) {
    const text = (event.items || []).join(' ').toLowerCase();
    for (const word of keywords) if (text.includes(word) && !found.includes(word)) found.push(word);
  }
  return found.join(', ');
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(String(value));
  if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  return String(value).slice(0, 10);
}

function titlecaseWords(value) {
  const text = String(value || '');
  if (!text || text === 'None') return 'Unknown';
  return text.replaceAll('_', ' ').split(/\s+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function truncate(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function stripHtml(value) {
  return String(value || '').replace(/<script.*?<\/script>/gis, ' ').replace(/<style.*?<\/style>/gis, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupeByKey(items, key) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const candidate = String(item?.[key] || '');
    if (!candidate || seen.has(candidate)) continue;
    unique.push(item);
    seen.add(candidate);
  }
  return unique;
}

function extractSearchLink(item) { return item.link || item.url || ''; }
function extractSearchTitle(item) { return item.title || item.title_link || 'Untitled result'; }
function extractSearchSnippet(item) { return truncate(item.snippet || (item.snippet_highlighted_words || [''])[0] || 'No snippet provided.', 220); }
function classifyFinding(item) {
  const text = [extractSearchTitle(item), extractSearchSnippet(item), extractSearchLink(item)].join(' ').toLowerCase();
  if (['recall', 'safety defect', 'manufacturer notice'].some((term) => text.includes(term))) return 'Recall';
  if (['auction', 'copart', 'synetiq', 'salvage'].some((term) => text.includes(term))) return 'Auction';
  if (['photo', 'image', 'gallery'].some((term) => text.includes(term))) return 'Photo';
  if (['advert', 'listing', 'autotrader', 'ebay', 'gumtree', 'motors.co.uk'].some((term) => text.includes(term))) return 'Advert';
  if (['forum', 'facebook', 'instagram', 'youtube', 'x.com', 'twitter'].some((term) => text.includes(term))) return 'Mention';
  return 'Listing';
}
function scoreConfidence(registration, item) {
  const text = [extractSearchTitle(item), extractSearchSnippet(item), extractSearchLink(item)].join(' ').toUpperCase();
  if (text.includes(registration)) return 'High';
  if (text.replaceAll(' ', '').includes(registration.replaceAll(' ', ''))) return 'Medium';
  return 'Low';
}
function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
