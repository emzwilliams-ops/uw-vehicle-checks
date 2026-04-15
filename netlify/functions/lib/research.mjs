import { getAppConfig } from './config.mjs';
import { ExternalServiceError, getText, postForm, postJson, getJson } from './http.mjs';
import { lookupSample } from './sample-data.mjs';

const DVLA_BASE_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';

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

  const dvlaData = await safeLookup(
    dataSources,
    'DVLA Vehicle Enquiry Service',
    'Vehicle make/model/year/tax/MOT status by registration.',
    Boolean(config.dvlaApiKey),
    () => lookupDvla(registration, config),
  );
  const motData = await safeLookup(
    dataSources,
    'DVSA MOT history API',
    'MOT history, mileage, failures, and advisories.',
    Boolean(config.motApiKey && config.motClientId && config.motClientSecret && config.motTokenUrl),
    () => lookupMot(registration, config),
  );

  dataSources.push({
    name: 'Open-web quick links',
    status: 'Built-in links ready',
    purpose: 'Free Google and GOV.UK links for adverts, auctions, photos, mentions, and recall follow-up.',
  });

  const vehicleSummary = buildVehicleSummary(registration, sample, dvlaData);
  const motHistory = buildMotHistory(sample, motData);
  const webFindings = buildWebFindings(registration, sample, vehicleSummary);
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
  const { body, contentType } = await getText(sourceUrl, {
    headers: { 'User-Agent': 'UnderwritingIntelligence/1.0' },
    timeoutSeconds: config.requestTimeoutSeconds,
  });
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
  return postJson(DVLA_BASE_URL, { registrationNumber: registration }, {
    headers: { Accept: 'application/json', 'x-api-key': config.dvlaApiKey },
    timeoutSeconds: config.requestTimeoutSeconds,
  });
}

async function lookupMot(registration, config) {
  const token = await getMotAccessToken(config);
  const url = config.motLookupUrl.replace('{registration}', registration);
  const response = await getJson(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-API-Key': config.motApiKey,
    },
    timeoutSeconds: config.requestTimeoutSeconds,
  });
  return Array.isArray(response) ? response : [response];
}

async function getMotAccessToken(config) {
  if (motTokenCache.token && Date.now() < motTokenCache.expiresAt) return motTokenCache.token;
  const tokenResponse = await postForm(config.motTokenUrl, {
    grant_type: 'client_credentials',
    client_id: config.motClientId,
    client_secret: config.motClientSecret,
    scope: config.motScope,
  }, { timeoutSeconds: config.requestTimeoutSeconds });
  if (!tokenResponse?.access_token) throw new ExternalServiceError('MOT token response did not include access_token');
  motTokenCache = {
    token: tokenResponse.access_token,
    expiresAt: Date.now() + Math.max((Number(tokenResponse.expires_in) || 300) - 60, 60) * 1000,
  };
  return motTokenCache.token;
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
        items: (item.rfrAndComments || [])
          .map((defect) => `${titlecaseWords(defect.type || 'comment')}: ${defect.text || 'No detail provided'}`)
          .concat((item.rfrAndComments || []).length ? [] : ['No defects or advisories recorded on this test entry.']),
      }));
    }
  }
  if (sample.mot_history?.length) return sample.mot_history;
  return [{
    date: 'Awaiting MOT API connection',
    result: 'No live data',
    mileage: '-',
    items: ['Add the DVSA MOT API credentials in Netlify environment variables to pull failures, advisories, and mileage trends.'],
  }];
}

function buildRecalls(registration, sample, webFindings) {
  const recalls = [...(sample.recalls || [])];
  if (!recalls.length) {
    recalls.push({
      status: 'Manual check',
      title: 'Official recall check',
      why_it_matters: 'Use the GOV.UK recall journey to confirm whether safety work is outstanding for this vehicle.',
      source_url: 'https://www.gov.uk/check-vehicle-recall',
    });
  }
  recalls.push({
    status: 'Official follow-up',
    title: `Check GOV.UK services for ${registration}`,
    why_it_matters: 'Use GOV.UK recall and MOT journeys to confirm any unresolved safety work or relevant MOT context.',
    source_url: 'https://www.gov.uk/check-vehicle-recall',
  });
  for (const item of webFindings.filter((finding) => finding.type === 'Recall link').slice(0, 1)) {
    recalls.push({
      status: 'Quick link',
      title: item.title,
      why_it_matters: item.excerpt,
      source_url: item.source_url,
    });
  }
  return dedupeByKey(recalls, 'title');
}

function buildWebFindings(registration, sample, vehicleSummary) {
  const quickLinks = buildQuickResearchLinks(registration, vehicleSummary);
  const sampleFindings = (sample.web_findings || []).slice(0, 4);
  return [...sampleFindings, ...quickLinks].slice(0, 12);
}

function buildQuickResearchLinks(registration, vehicleSummary) {
  const make = String(vehicleSummary.make || '').trim();
  const model = String(vehicleSummary.model || '').trim();
  const makeModel = [make, model].filter(Boolean).join(' ');
  const exact = `"${registration}"`;
  const exactMakeModel = makeModel ? `${exact} "${makeModel}"` : exact;
  return [
    {
      type: 'Search link',
      title: 'Google exact registration search',
      excerpt: 'Use this free search to look for any indexed references to the registration.',
      source_url: `https://www.google.com/search?q=${encodeURIComponent(exact)}`,
      confidence: 'Manual',
    },
    {
      type: 'Search link',
      title: 'Search adverts and listings',
      excerpt: 'Look for dealer listings, classifieds, and sale pages mentioning the registration.',
      source_url: `https://www.google.com/search?q=${encodeURIComponent(`${exactMakeModel} advert OR listing OR sale`)}`,
      confidence: 'Manual',
    },
    {
      type: 'Search link',
      title: 'Search auction and salvage history',
      excerpt: 'Look for auction, salvage, or disposal references linked to the registration.',
      source_url: `https://www.google.com/search?q=${encodeURIComponent(`${exactMakeModel} auction OR salvage OR copart OR synetiq`)}`,
      confidence: 'Manual',
    },
    {
      type: 'Search link',
      title: 'Search photos and image traces',
      excerpt: 'Use image-oriented search terms to look for historic photos or gallery pages.',
      source_url: `https://www.google.com/search?q=${encodeURIComponent(`${exactMakeModel} photo OR image OR gallery`)}`,
      confidence: 'Manual',
    },
    {
      type: 'Search link',
      title: 'Search forum and social mentions',
      excerpt: 'Look for public forum, social, or discussion references to the vehicle.',
      source_url: `https://www.google.com/search?q=${encodeURIComponent(`${exactMakeModel} forum OR facebook OR instagram OR youtube`)}`,
      confidence: 'Manual',
    },
    {
      type: 'Recall link',
      title: 'Open GOV.UK recall checker',
      excerpt: 'Use the official registration-based recall journey for manual follow-up.',
      source_url: 'https://www.gov.uk/check-vehicle-recall',
      confidence: 'Official',
    },
  ];
}

function buildResearchFlags(motHistory, recalls, webFindings) {
  const flags = [];
  const recurring = summarizeMotTerms(motHistory);
  if (recurring) flags.push({ title: 'Recurring MOT themes', severity: 'Medium', detail: `Repeated MOT language spotted around: ${recurring}.` });
  if (recalls.some((item) => ['open', 'manual check', 'official follow-up', 'quick link'].includes(String(item.status || '').toLowerCase()))) {
    flags.push({ title: 'Recall follow-up required', severity: 'High', detail: 'Recall-related follow-up links are present. Confirm whether any manufacturer remedy was outstanding at the time of loss.' });
  }
  if (webFindings.some((item) => ['advert', 'auction', 'listing'].includes(String(item.type || '').toLowerCase()))) {
    flags.push({ title: 'Historic listing evidence found', severity: 'Medium', detail: 'Listings can reveal prior damage, warning lights, modifications, or sale descriptions worth cross-checking.' });
  }
  if (webFindings.some((item) => item.type === 'Search link')) {
    flags.push({ title: 'Manual open-web research available', severity: 'Low', detail: 'Free Google research links are ready for adverts, auctions, photos, and mentions.' });
  }
  if (!flags.length) flags.push({ title: 'No strong flags yet', severity: 'Low', detail: 'The registration was processed, but richer signals depend on official keys and manual open-web follow-up.' });
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
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
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
  return String(value || '')
    .replace(/<script.*?<\/script>/gis, ' ')
    .replace(/<style.*?<\/style>/gis, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
