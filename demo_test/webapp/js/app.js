import {
  COMPARATORS,
  DEFAULT_STATE,
  GRANULARITIES_BY_ID,
  GROUPS_BY_ID,
  HEAT_GRADIENT,
  METRIC_GROUPS,
  METRICS,
  METRICS_BY_ID,
  POPULAR_CUTS,
} from './config.js';

const state = {
  ...DEFAULT_STATE,
  cuts: [],
};
const refs = {};
const formatters = {
  integer: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),
  decimal: new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }),
  percent: new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }),
  currency: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }),
};

const geographyIndex = {
  states: [],
  counties: [],
  countiesByState: new Map(),
  msas: [],
  msasByState: new Map(),
};

let datasets = {
  zip: [],
  county: [],
  msa: [],
  state: [],
};
let meta = null;
let map = null;
let heatLayer = null;
let markersLayer = null;
let rowMarkerMap = new Map();
let lastFilteredRows = [];
let lastDisplayRows = [];
let hasFittedInitialBounds = false;
let inputDebounce = null;
let toastTimeout = null;

window.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheRefs();
  initDarkMode();
  initCollapsibles();
  initMap();
  bindEvents();

  try {
    setLoading(true, 'Loading compact demographic dataset...');

    const [zipRows, rollups, metaResponse] = await Promise.all([
      fetchJson('./data/demos_compact.json'),
      fetchJson('./data/demos_rollups.json'),
      fetchJson('./data/meta.json'),
    ]);

    datasets = {
      zip: zipRows,
      county: rollups.county || [],
      msa: rollups.msa || [],
      state: rollups.state || [],
    };
    meta = metaResponse;

    buildGeographyIndex();
    hydrateMetricSelects();
    renderPopularCuts();
    restoreFromUrl();
    sanitizeGeographySelections();
    hydrateGeographySelects();
    renderCuts();
    render();

    setLoading(false);
  } catch (error) {
    console.error(error);
    setLoading(true, 'Could not load the generated data bundle. Rebuild the data and refresh the page.');
  }
}

function cacheRefs() {
  refs.loading = document.getElementById('loadingOverlay');
  refs.metricSelect = document.getElementById('metricSelect');
  refs.metricDescription = document.getElementById('metricDescription');
  refs.legendScale = document.getElementById('legendScale');
  refs.stateField = document.getElementById('stateField');
  refs.countyField = document.getElementById('countyField');
  refs.msaField = document.getElementById('msaField');
  refs.stateSelect = document.getElementById('stateSelect');
  refs.countySelect = document.getElementById('countySelect');
  refs.msaSelect = document.getElementById('msaSelect');
  refs.searchInput = document.getElementById('searchInput');
  refs.minPopulation = document.getElementById('minPopulation');
  refs.excludeZero = document.getElementById('excludeZero');
  refs.excludeZeroLabel = document.getElementById('excludeZeroLabel');
  refs.popularCuts = document.getElementById('popularCuts');
  refs.cutsList = document.getElementById('cutsList');
  refs.addCut = document.getElementById('addCutButton');
  refs.clearCuts = document.getElementById('clearCutsButton');
  refs.fitResults = document.getElementById('fitResultsButton');
  refs.exportCsv = document.getElementById('exportCsvButton');
  refs.resetAll = document.getElementById('resetAllButton');
  refs.darkToggle = document.getElementById('darkModeToggle');
  refs.granularityPicker = document.getElementById('granularityPicker');
  refs.topResultsHeading = document.getElementById('topResultsHeading');
  refs.status = document.getElementById('statusText');
  refs.summaryCards = document.getElementById('summaryCards');
  refs.topResults = document.getElementById('topResults');
  refs.generatedAt = document.getElementById('generatedAt');
  refs.toast = document.getElementById('toast');
}

// --- Dark Mode ---

function initDarkMode() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  showToast(next === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
}

// --- Collapsible Sections ---

function initCollapsibles() {
  document.querySelectorAll('.collapsible').forEach((section) => {
    section.setAttribute('aria-expanded', 'true');
    const trigger = section.querySelector('.collapsible-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', () => toggleCollapsible(section));
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleCollapsible(section);
      }
    });
  });
}

function toggleCollapsible(section) {
  const expanded = section.getAttribute('aria-expanded') === 'true';
  section.setAttribute('aria-expanded', String(!expanded));
}

// --- Toast ---

function showToast(message) {
  clearTimeout(toastTimeout);
  refs.toast.textContent = message;
  refs.toast.classList.add('visible');
  toastTimeout = setTimeout(() => {
    refs.toast.classList.remove('visible');
  }, 2400);
}

// --- Map ---

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    scrollWheelZoom: true,
  }).setView([39.5, -98.35], 4);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 18,
  }).addTo(map);

  heatLayer = L.heatLayer([], {
    radius: 26,
    blur: 22,
    maxZoom: 11,
    minOpacity: 0.35,
    gradient: HEAT_GRADIENT,
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

// --- Events ---

function bindEvents() {
  refs.metricSelect.addEventListener('change', () => {
    state.selectedMetricId = refs.metricSelect.value;
    renderCuts();
    render();
    pushUrl();
  });

  refs.stateSelect.addEventListener('change', () => {
    state.state = refs.stateSelect.value;
    sanitizeGeographySelections();
    hydrateGeographySelects();
    render();
    pushUrl();
  });

  refs.countySelect.addEventListener('change', () => {
    state.county = refs.countySelect.value;
    render();
    pushUrl();
  });

  refs.msaSelect.addEventListener('change', () => {
    state.msa = refs.msaSelect.value;
    render();
    pushUrl();
  });

  refs.searchInput.addEventListener('input', () => {
    state.search = refs.searchInput.value.trim();
    scheduleRender();
  });

  refs.minPopulation.addEventListener('input', () => {
    state.minPopulation = refs.minPopulation.value.trim();
    scheduleRender();
  });

  refs.excludeZero.addEventListener('change', () => {
    state.excludeZero = refs.excludeZero.checked;
    render();
    pushUrl();
  });

  refs.addCut.addEventListener('click', () => {
    addCut();
  });

  refs.clearCuts.addEventListener('click', () => {
    state.cuts = [];
    renderCuts();
    render();
    pushUrl();
    showToast('All cuts cleared');
  });

  refs.fitResults.addEventListener('click', () => {
    fitToRows(lastDisplayRows);
  });

  refs.exportCsv.addEventListener('click', () => {
    exportFilteredCsv();
  });

  refs.resetAll.addEventListener('click', () => {
    resetAllFilters();
  });

  refs.darkToggle.addEventListener('click', () => {
    toggleDarkMode();
  });

  refs.granularityPicker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-gran]');
    if (!button || button.classList.contains('active')) return;

    state.granularity = button.dataset.gran;
    sanitizeGeographySelections({ clearIncompatible: true });
    syncGranularityPicker();
    hydrateGeographySelects();
    renderCuts();
    render();
    pushUrl();
    showToast(`Viewing by ${GRANULARITIES_BY_ID[state.granularity].label}`);
  });

  refs.cutsList.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) {
      return;
    }

    const cutCard = target.closest('[data-cut-id]');
    const cutId = cutCard ? cutCard.dataset.cutId : '';
    if (!cutId) {
      return;
    }

    if (target.dataset.action === 'remove-cut') {
      state.cuts = state.cuts.filter((cut) => cut.id !== cutId);
      renderCuts();
      render();
      pushUrl();
    }
  });

  refs.cutsList.addEventListener('change', (event) => {
    const field = event.target.dataset.field;
    const cutCard = event.target.closest('[data-cut-id]');
    const cutId = cutCard ? cutCard.dataset.cutId : '';
    if (!field || !cutId) {
      return;
    }

    const cut = state.cuts.find((entry) => entry.id === cutId);
    if (!cut) {
      return;
    }

    cut[field] = event.target.value;

    if (field === 'metricId') {
      const metric = METRICS_BY_ID[cut.metricId];
      cut.value1 = defaultCutValue(metric, cut.comparator);
      cut.value2 = '';
    }

    if (field === 'comparator' && cut.comparator !== 'between') {
      cut.value2 = '';
    }

    renderCuts();
    render();
    pushUrl();
  });

  refs.cutsList.addEventListener('input', (event) => {
    const field = event.target.dataset.field;
    const cutCard = event.target.closest('[data-cut-id]');
    const cutId = cutCard ? cutCard.dataset.cutId : '';
    if (!field || !cutId) {
      return;
    }

    const cut = state.cuts.find((entry) => entry.id === cutId);
    if (!cut) {
      return;
    }

    cut[field] = event.target.value;
    scheduleRender();
  });

  refs.topResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-row-id]');
    if (!button) {
      return;
    }

    const row = lastDisplayRows.find((entry) => entry.id === button.dataset.rowId);
    if (!row) {
      return;
    }

    focusRow(row);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT')) {
        activeElement.blur();
      }
    }
  });

  window.addEventListener('popstate', () => {
    restoreFromUrl();
    sanitizeGeographySelections();
    hydrateMetricSelects();
    hydrateGeographySelects();
    renderCuts();
    render();
  });
}

function scheduleRender() {
  clearTimeout(inputDebounce);
  inputDebounce = window.setTimeout(() => {
    render();
    pushUrl();
  }, 120);
}

// --- Reset All ---

function resetAllFilters() {
  Object.assign(state, { ...DEFAULT_STATE, cuts: [] });
  refs.metricSelect.value = state.selectedMetricId;
  refs.searchInput.value = '';
  refs.minPopulation.value = '';
  refs.excludeZero.checked = true;
  syncGranularityPicker();
  sanitizeGeographySelections({ clearIncompatible: true });
  hydrateGeographySelects();
  renderCuts();
  render();
  pushUrl();
  showToast('All filters reset');
}

// --- Granularity & Geography ---

function syncGranularityPicker() {
  refs.granularityPicker.querySelectorAll('[data-gran]').forEach((btn) => {
    const isActive = btn.dataset.gran === state.granularity;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', String(isActive));
  });
}

function buildGeographyIndex() {
  geographyIndex.states = datasets.state
    .map((row) => row.st)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  geographyIndex.counties = datasets.county
    .map((row) => ({
      value: row.ck,
      label: formatCountyLabel(row, false),
      shortLabel: formatCountyLabel(row, true),
      state: row.st,
    }))
    .filter((row) => row.value)
    .sort((left, right) => left.label.localeCompare(right.label));

  geographyIndex.countiesByState = new Map();
  geographyIndex.counties.forEach((option) => {
    if (!option.state) return;
    if (!geographyIndex.countiesByState.has(option.state)) {
      geographyIndex.countiesByState.set(option.state, []);
    }
    geographyIndex.countiesByState.get(option.state).push({
      value: option.value,
      label: option.shortLabel,
      shortLabel: option.shortLabel,
      state: option.state,
    });
  });
  geographyIndex.countiesByState.forEach((options) => {
    options.sort((left, right) => left.label.localeCompare(right.label));
  });

  geographyIndex.msas = datasets.msa
    .map((row) => ({
      value: row.mc,
      label: row.msa || row.z,
      states: Array.isArray(row.sts) ? row.sts : row.st ? [row.st] : [],
    }))
    .filter((row) => row.value && row.label)
    .sort((left, right) => left.label.localeCompare(right.label));

  geographyIndex.msasByState = new Map();
  geographyIndex.msas.forEach((option) => {
    option.states.forEach((stateName) => {
      if (!geographyIndex.msasByState.has(stateName)) {
        geographyIndex.msasByState.set(stateName, []);
      }
      geographyIndex.msasByState.get(stateName).push({
        value: option.value,
        label: option.label,
        states: option.states,
      });
    });
  });
  geographyIndex.msasByState.forEach((options) => {
    options.sort((left, right) => left.label.localeCompare(right.label));
  });
}

function granLabel(plural) {
  const granularity = state.granularity;
  if (plural) {
    if (granularity === 'county') return 'Counties';
    if (granularity === 'msa') return 'MSAs';
    if (granularity === 'state') return 'States';
    return 'ZIPs';
  }
  return GRANULARITIES_BY_ID[granularity].label;
}

function getFilterCapabilities() {
  return {
    county: state.granularity === 'zip' || state.granularity === 'county',
    msa: state.granularity === 'zip' || state.granularity === 'msa',
  };
}

function sanitizeGeographySelections({ clearIncompatible = false } = {}) {
  const capabilities = getFilterCapabilities();

  if (!geographyIndex.states.includes(state.state)) {
    state.state = '';
  }

  if (!capabilities.county && clearIncompatible) {
    state.county = '';
  }
  if (!capabilities.msa && clearIncompatible) {
    state.msa = '';
  }

  const validCountyValues = new Set(getCountyOptions().map((option) => option.value));
  if (!capabilities.county || (state.county && !validCountyValues.has(state.county))) {
    state.county = '';
  }

  const validMsaValues = new Set(getMsaOptions().map((option) => option.value));
  if (!capabilities.msa || (state.msa && !validMsaValues.has(state.msa))) {
    state.msa = '';
  }
}

function hydrateGeographySelects() {
  populateSelect(
    refs.stateSelect,
    geographyIndex.states.map((value) => ({ value, label: value })),
    'All states',
    state.state
  );
  populateSelect(refs.countySelect, getCountyOptions(), 'All counties', state.county);
  populateSelect(refs.msaSelect, getMsaOptions(), 'All MSAs', state.msa);

  refs.metricSelect.value = state.selectedMetricId;
  refs.searchInput.value = state.search;
  refs.minPopulation.value = state.minPopulation;
  refs.excludeZero.checked = state.excludeZero;
  refs.generatedAt.textContent = formatGeneratedAt(meta ? meta.generatedAt : null);

  updateFilterAvailability();
}

function updateFilterAvailability() {
  const capabilities = getFilterCapabilities();

  setFieldEnabled(refs.countyField, refs.countySelect, capabilities.county);
  setFieldEnabled(refs.msaField, refs.msaSelect, capabilities.msa);

  refs.excludeZeroLabel.textContent = `Exclude zero-population ${granLabel(true).toLowerCase()}`;
  refs.searchInput.placeholder = getSearchPlaceholder();
}

function setFieldEnabled(wrapper, control, enabled) {
  wrapper.classList.toggle('is-disabled', !enabled);
  control.disabled = !enabled;
}

function getSearchPlaceholder() {
  if (state.granularity === 'state') return 'State name';
  if (state.granularity === 'msa') return 'MSA or state';
  if (state.granularity === 'county') return 'County or state';
  return 'ZIP, place, county, MSA';
}

function getCountyOptions() {
  if (state.state && geographyIndex.countiesByState.has(state.state)) {
    return geographyIndex.countiesByState.get(state.state);
  }
  return geographyIndex.counties;
}

function getMsaOptions() {
  if (state.state && geographyIndex.msasByState.has(state.state)) {
    return geographyIndex.msasByState.get(state.state);
  }
  return geographyIndex.msas;
}

function populateSelect(select, options, placeholder, selectedValue) {
  const items = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(
      options.map((option) => {
        const value = typeof option === 'string' ? option : option.value;
        const label = typeof option === 'string' ? option : option.label;
        const selected = value === selectedValue ? 'selected' : '';
        return `<option value="${escapeAttribute(value)}" ${selected}>${escapeHtml(label)}</option>`;
      })
    )
    .join('');

  select.innerHTML = items;
}

function formatCountyLabel(row, short) {
  if (!row.cty) {
    return short ? 'Unknown County' : 'Unknown County';
  }
  if (short || !row.st) {
    return row.cty;
  }
  return `${row.cty}, ${row.st}`;
}

// --- CSV Export ---

function exportFilteredCsv() {
  if (!lastDisplayRows.length) {
    showToast('No results to export');
    return;
  }

  const metric = METRICS_BY_ID[state.selectedMetricId];
  const granularity = state.granularity;
  const isZip = granularity === 'zip';
  const headers = isZip
    ? ['ZIP', 'Name', 'County', 'State', 'MSA', 'Population', 'Households', metric.label]
    : [granLabel(false), 'State Coverage', 'Population', 'Households', 'ZIP Count', metric.label];
  const csvRows = [headers.join(',')];

  for (const row of lastDisplayRows) {
    if (isZip) {
      csvRows.push(
        [
          row.z,
          csvEscape(row.nm || ''),
          csvEscape(row.cty || ''),
          csvEscape(row.st || ''),
          csvEscape(row.msa || ''),
          row.pop || 0,
          row.hh || 0,
          row[metric.key] != null ? row[metric.key] : '',
        ].join(',')
      );
    } else {
      csvRows.push(
        [
          csvEscape(getRowPrimaryLabel(row)),
          csvEscape(formatStateCoverage(row, true)),
          row.pop || 0,
          row.hh || 0,
          row._zipCount || 0,
          row[metric.key] != null ? row[metric.key] : '',
        ].join(',')
      );
    }
  }

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `demographics_${granularity}_${state.selectedMetricId}_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${formatters.integer.format(lastDisplayRows.length)} ${granLabel(true).toLowerCase()}`);
}

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// --- URL State ---

function pushUrl() {
  const params = new URLSearchParams();
  if (state.selectedMetricId !== DEFAULT_STATE.selectedMetricId) params.set('metric', state.selectedMetricId);
  if (state.granularity !== DEFAULT_STATE.granularity) params.set('gran', state.granularity);
  if (state.state) params.set('state', state.state);
  if (state.county) params.set('county', state.county);
  if (state.msa) params.set('msa', state.msa);
  if (state.search) params.set('q', state.search);
  if (state.minPopulation) params.set('minpop', state.minPopulation);
  if (!state.excludeZero) params.set('zero', '1');

  if (state.cuts.length) {
    const cutsData = state.cuts.map((cut) => ({
      m: cut.metricId,
      c: cut.comparator,
      v1: cut.value1,
      v2: cut.value2,
    }));
    params.set('cuts', btoa(JSON.stringify(cutsData)));
  }

  const search = params.toString();
  const newUrl = search ? `?${search}` : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
}

function restoreFromUrl() {
  Object.assign(state, { ...DEFAULT_STATE, cuts: [] });

  const params = new URLSearchParams(window.location.search);

  if (params.has('metric') && METRICS_BY_ID[params.get('metric')]) {
    state.selectedMetricId = params.get('metric');
  }
  if (params.has('gran') && GRANULARITIES_BY_ID[params.get('gran')]) {
    state.granularity = params.get('gran');
  }
  if (params.has('state')) state.state = params.get('state');
  if (params.has('county')) state.county = params.get('county');
  if (params.has('msa')) state.msa = params.get('msa');
  if (params.has('q')) state.search = params.get('q');
  if (params.has('minpop')) state.minPopulation = params.get('minpop');
  if (params.has('zero')) state.excludeZero = false;

  if (params.has('cuts')) {
    try {
      const cutsData = JSON.parse(atob(params.get('cuts')));
      state.cuts = cutsData.map((entry) => ({
        id: createId(),
        metricId: entry.m,
        comparator: entry.c,
        value1: entry.v1,
        value2: entry.v2,
      }));
    } catch (_) {
      state.cuts = [];
    }
  }

  refs.metricSelect.value = state.selectedMetricId;
  refs.searchInput.value = state.search;
  refs.minPopulation.value = state.minPopulation;
  refs.excludeZero.checked = state.excludeZero;
  syncGranularityPicker();
}

// --- Hydration ---

function hydrateMetricSelects() {
  refs.metricSelect.innerHTML = buildMetricOptions(state.selectedMetricId);
}

function buildMetricOptions(selectedMetricId) {
  return METRIC_GROUPS.map((group) => {
    const options = METRICS.filter((metric) => metric.group === group.id)
      .map(
        (metric) =>
          `<option value="${metric.id}" ${metric.id === selectedMetricId ? 'selected' : ''}>${metric.label}</option>`
      )
      .join('');

    return `<optgroup label="${group.label}">${options}</optgroup>`;
  }).join('');
}

// --- Popular Cuts ---

function renderPopularCuts() {
  refs.popularCuts.innerHTML = METRIC_GROUPS.map((group) => {
    const cuts = POPULAR_CUTS.filter((item) => item.group === group.id);
    if (!cuts.length) {
      return '';
    }

    const buttons = cuts
      .map(
        (cut) =>
          `<button class="preset-chip" data-preset="${cut.label}">${escapeHtml(cut.label)}</button>`
      )
      .join('');

    return `
      <section class="preset-group">
        <div>
          <p class="preset-title">${escapeHtml(group.label)}</p>
          <p class="preset-blurb">${escapeHtml(group.blurb)}</p>
        </div>
        <div class="preset-chip-row">${buttons}</div>
      </section>
    `;
  }).join('');

  refs.popularCuts.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = POPULAR_CUTS.find((item) => item.label === button.dataset.preset);
      addCut(preset);
      showToast(`Added cut: ${preset.label}`);
    });
  });
}

// --- Cuts ---

function addCut(preset = null) {
  const metricId = preset && preset.metricId ? preset.metricId : 'mhi';
  const metric = METRICS_BY_ID[metricId];
  const comparator = preset && preset.comparator ? preset.comparator : 'gte';

  state.cuts.push({
    id: createId(),
    metricId: metric.id,
    comparator,
    value1: preset && preset.value1 != null ? preset.value1 : defaultCutValue(metric, comparator),
    value2: preset && preset.value2 != null ? preset.value2 : '',
  });

  renderCuts();
  render();
  pushUrl();
}

function createId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `cut-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultCutValue(metric, comparator) {
  const stats = getOverallMetricStats(metric.id);
  if (!stats) {
    return '';
  }
  return comparator === 'lte' ? stats.p50 : stats.p50;
}

function renderCuts() {
  if (!state.cuts.length) {
    refs.cutsList.innerHTML = `
      <div class="empty-slot">
        <p>Stack one or more custom demo cuts to narrow the heatmap.</p>
        <p>Use the grouped presets above or add a custom rule.</p>
      </div>
    `;
    return;
  }

  refs.cutsList.innerHTML = state.cuts
    .map((cut) => {
      const metric = METRICS_BY_ID[cut.metricId];
      const group = GROUPS_BY_ID[metric.group];
      const stats = getOverallMetricStats(metric.id);
      const step = metric.inputStep || metric.comparatorStep || 1;
      const betweenActive = cut.comparator === 'between';

      return `
        <article class="cut-card" data-cut-id="${cut.id}">
          <div class="cut-card-head">
            <div>
              <span class="group-tag">${escapeHtml(group.label)}</span>
              <p class="cut-card-title">${escapeHtml(metric.label)}</p>
            </div>
            <button class="icon-button" data-action="remove-cut" type="button" aria-label="Remove cut">Remove</button>
          </div>
          <div class="cut-grid">
            <label>
              <span>Metric</span>
              <select data-field="metricId">${buildMetricOptions(cut.metricId)}</select>
            </label>
            <label>
              <span>Rule</span>
              <select data-field="comparator">
                ${COMPARATORS.map(
                  (item) =>
                    `<option value="${item.value}" ${item.value === cut.comparator ? 'selected' : ''}>${item.label}</option>`
                ).join('')}
              </select>
            </label>
            <label>
              <span>${betweenActive ? 'From' : 'Value'}</span>
              <input type="number" step="${step}" data-field="value1" value="${escapeAttribute(cut.value1)}" />
            </label>
            <label class="${betweenActive ? '' : 'hidden'}">
              <span>To</span>
              <input type="number" step="${step}" data-field="value2" value="${escapeAttribute(cut.value2)}" />
            </label>
          </div>
          <p class="cut-hint">${escapeHtml(metric.description)} ${stats ? `Typical ${granLabel(true).toLowerCase()} range ${formatMetricValue(metric, stats.p05)} to ${formatMetricValue(metric, stats.p95)}.` : ''}</p>
        </article>
      `;
    })
    .join('');
}

// --- Render ---

function render() {
  const metric = METRICS_BY_ID[state.selectedMetricId];
  const currentRows = getCurrentRows();
  const displayRows = currentRows.filter((row) => matchesAllFilters(row, metric));
  const visibleStats = computeMetricStats(displayRows, metric) || getOverallMetricStats(metric.id);

  lastFilteredRows = displayRows;
  lastDisplayRows = displayRows;

  updateMetricDescription(metric);
  updateLegend(metric, visibleStats);
  updateStatus(displayRows);
  updateSummaryCards(displayRows, metric);
  updateTopResults(displayRows, metric);
  updateMap(displayRows, metric, visibleStats);
}

function getCurrentRows() {
  return datasets[state.granularity] || [];
}

function matchesAllFilters(row, selectedMetric) {
  if (state.excludeZero && (row.pop || 0) <= 0) {
    return false;
  }

  const minPopulation = Number(state.minPopulation || 0);
  if (Number.isFinite(minPopulation) && minPopulation > 0 && (row.pop || 0) < minPopulation) {
    return false;
  }

  if (!matchesStateFilter(row)) {
    return false;
  }

  if (!matchesCountyFilter(row)) {
    return false;
  }

  if (!matchesMsaFilter(row)) {
    return false;
  }

  if (state.search && !matchesSearch(row, state.search)) {
    return false;
  }

  if (row[selectedMetric.key] == null) {
    return false;
  }

  for (const cut of state.cuts) {
    const metric = METRICS_BY_ID[cut.metricId];
    const value = row[metric.key];
    if (value == null) {
      return false;
    }

    const v1 = Number(cut.value1);
    const v2 = Number(cut.value2);

    if (cut.comparator === 'gte' && Number.isFinite(v1) && value < v1) {
      return false;
    }

    if (cut.comparator === 'lte' && Number.isFinite(v1) && value > v1) {
      return false;
    }

    if (cut.comparator === 'between') {
      const rangeValues = [v1, v2].filter((candidate) => Number.isFinite(candidate));
      const rangeMin = rangeValues.length ? Math.min(...rangeValues) : null;
      const rangeMax = rangeValues.length ? Math.max(...rangeValues) : null;

      if (rangeMin != null && value < rangeMin) {
        return false;
      }
      if (rangeMax != null && value > rangeMax) {
        return false;
      }
    }
  }

  return true;
}

function matchesStateFilter(row) {
  if (!state.state) {
    return true;
  }
  return extractStates(row).includes(state.state);
}

function matchesCountyFilter(row) {
  if (!state.county) {
    return true;
  }
  if (state.granularity === 'zip' || state.granularity === 'county') {
    return row.ck === state.county;
  }
  return true;
}

function matchesMsaFilter(row) {
  if (!state.msa) {
    return true;
  }
  if (state.granularity === 'zip' || state.granularity === 'msa') {
    return row.mc === state.msa;
  }
  return true;
}

function matchesSearch(row, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [row.z, row.nm, row.cty, row.msa, row.st]
    .concat(extractStates(row))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function updateMetricDescription(metric) {
  const group = GROUPS_BY_ID[metric.group];
  const stats = getOverallMetricStats(metric.id);

  refs.metricDescription.innerHTML = `
    <span class="metric-group-label">${escapeHtml(group.label)}</span>
    <strong>${escapeHtml(metric.label)}</strong>
    <span>${escapeHtml(metric.description)}</span>
    ${stats ? `<span>Typical ${granLabel(true).toLowerCase()} range: ${formatMetricValue(metric, stats.p05)} to ${formatMetricValue(metric, stats.p95)}.</span>` : ''}
  `;
}

function updateLegend(metric, stats) {
  if (!stats) {
    refs.legendScale.textContent = 'No legend available';
    return;
  }

  refs.legendScale.innerHTML = `
    <span>${formatMetricValue(metric, stats.p05)}</span>
    <span>${formatMetricValue(metric, stats.p50)}</span>
    <span>${formatMetricValue(metric, stats.p95)}</span>
  `;
}

function updateStatus(rows) {
  const statesCovered = countCoveredStates(rows);
  const population = rows.reduce((sum, row) => sum + (row.pop || 0), 0);

  if (state.granularity === 'zip') {
    refs.status.textContent = `${formatters.integer.format(rows.length)} ZIPs matched across ${formatters.integer.format(statesCovered)} states, representing ${formatters.integer.format(population)} people.`;
    return;
  }

  const zipCoverage = rows.reduce((sum, row) => sum + (row._zipCount || 0), 0);
  refs.status.textContent = `${formatters.integer.format(rows.length)} ${granLabel(true)} matched across ${formatters.integer.format(statesCovered)} states, covering ${formatters.integer.format(zipCoverage)} ZIPs and ${formatters.integer.format(population)} people.`;
}

function updateSummaryCards(rows, metric) {
  const population = rows.reduce((sum, row) => sum + (row.pop || 0), 0);
  const households = rows.reduce((sum, row) => sum + (row.hh || 0), 0);
  const metricValues = rows.map((row) => row[metric.key]).filter((value) => value != null);
  const averageMetric = metricValues.length
    ? metricValues.reduce((sum, value) => sum + value, 0) / metricValues.length
    : null;
  const topRow = getTopRows(rows, metric, 1)[0] || null;

  const unitLabel = granLabel(true);
  const unitSingular = granLabel(false);

  refs.summaryCards.innerHTML = [
    buildSummaryCard(`Matching ${unitLabel}`, formatters.integer.format(rows.length), `${formatters.integer.format(countCoveredStates(rows))} states in play`),
    buildSummaryCard('Population In View', formatters.integer.format(population), `${formatters.integer.format(households)} households across the current cut`),
    buildSummaryCard(`Average ${metric.shortLabel}`, averageMetric == null ? 'No data' : formatMetricValue(metric, averageMetric), `Average across the matched ${unitLabel.toLowerCase()}`),
    buildSummaryCard(`Top ${unitSingular}`, topRow ? getRowPrimaryLabel(topRow) : 'No matches', topRow ? `${formatMetricValue(metric, topRow[metric.key])} on the selected heat metric` : 'Adjust the filters to recover results'),
  ].join('');
}

function buildSummaryCard(label, value, detail) {
  return `
    <article class="summary-card">
      <p class="summary-label">${escapeHtml(label)}</p>
      <p class="summary-value">${escapeHtml(value)}</p>
      <p class="summary-detail">${escapeHtml(detail)}</p>
    </article>
  `;
}

function updateTopResults(rows, metric) {
  const topRows = getTopRows(rows, metric, 12);
  const unitLabel = granLabel(true);

  refs.topResultsHeading.textContent = `Top ${unitLabel} by selected heat metric`;

  if (!topRows.length) {
    refs.topResults.innerHTML = `
      <div class="empty-slot compact">
        <p>No ${unitLabel.toLowerCase()} match the current geography and demographic cuts.</p>
      </div>
    `;
    return;
  }

  refs.topResults.innerHTML = topRows
    .map((row, index) => {
      const secondary = getRowSecondaryLabel(row);
      return `
        <button class="result-row" type="button" data-row-id="${escapeAttribute(row.id)}">
          <span class="result-rank">${index + 1}</span>
          <span class="result-copy">
            <strong>${escapeHtml(getRowPrimaryLabel(row))}</strong>
            <span>${escapeHtml(secondary)}</span>
          </span>
          <span class="result-metric">${formatMetricValue(metric, row[metric.key])}</span>
        </button>
      `;
    })
    .join('');
}

function getTopRows(rows, metric, count) {
  return rows
    .filter((row) => row[metric.key] != null)
    .slice()
    .sort((left, right) => right[metric.key] - left[metric.key])
    .slice(0, count)
    .map((row) => ({ ...row }));
}

// --- Map Updates ---

function updateMap(rows, metric, stats) {
  const heatPoints = [];

  const radiusMap = { zip: 26, county: 34, msa: 42, state: 56 };
  const blurMap = { zip: 22, county: 28, msa: 34, state: 42 };
  const newRadius = radiusMap[state.granularity] || 26;
  const newBlur = blurMap[state.granularity] || 22;
  if (heatLayer.options.radius !== newRadius || heatLayer.options.blur !== newBlur) {
    map.removeLayer(heatLayer);
    heatLayer = L.heatLayer([], {
      radius: newRadius,
      blur: newBlur,
      maxZoom: 11,
      minOpacity: 0.35,
      gradient: HEAT_GRADIENT,
    }).addTo(map);
  }

  for (const row of rows) {
    const weight = normalizeMetricValue(row[metric.key], metric, stats);
    if (!Number.isFinite(weight) || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
      continue;
    }
    heatPoints.push([row.lat, row.lng, weight]);
  }

  heatLayer.setLatLngs(heatPoints);
  renderMarkers(rows, metric);

  if (!hasFittedInitialBounds && rows.length) {
    fitToRows(rows);
    hasFittedInitialBounds = true;
  }
}

function renderMarkers(rows, metric) {
  markersLayer.clearLayers();
  rowMarkerMap = new Map();

  const markerCountMap = { zip: 20, county: 30, msa: 40, state: 60 };
  const markerCount = markerCountMap[state.granularity] || 20;
  const topRows = getTopRows(rows, metric, markerCount);
  topRows.forEach((row, index) => {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
      return;
    }

    const marker = L.circleMarker([row.lat, row.lng], {
      radius: 4 + Math.max(0, 7 - index * 0.2),
      weight: 1.5,
      color: '#fdf4dd',
      fillColor: '#12343b',
      fillOpacity: 0.9,
    }).bindPopup(buildPopupContent(row, metric));

    marker.addTo(markersLayer);
    rowMarkerMap.set(row.id, marker);
  });
}

function buildPopupContent(row, metric) {
  const title = getRowPrimaryLabel(row);
  const subtitle = getRowSubtitle(row);
  const extra = state.granularity === 'zip'
    ? ''
    : `<p><strong>ZIP coverage:</strong> ${formatters.integer.format(row._zipCount || 0)}</p>`;

  return `
    <div class="popup-copy">
      <p class="popup-title">${escapeHtml(title)}</p>
      ${subtitle ? `<p class="popup-subtitle">${escapeHtml(subtitle)}</p>` : ''}
      <p><strong>${escapeHtml(metric.label)}:</strong> ${escapeHtml(formatMetricValue(metric, row[metric.key]))}</p>
      <p><strong>Population:</strong> ${escapeHtml(formatters.integer.format(row.pop || 0))}</p>
      <p><strong>Households:</strong> ${escapeHtml(formatters.integer.format(row.hh || 0))}</p>
      ${extra}
    </div>
  `;
}

function focusRow(row) {
  const marker = rowMarkerMap.get(row.id);
  if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
    map.flyTo([row.lat, row.lng], Math.max(map.getZoom(), 9), {
      duration: 0.8,
    });
  }

  if (marker) {
    window.setTimeout(() => {
      marker.openPopup();
    }, 350);
  }
}

function fitToRows(rows) {
  const validRows = rows.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));

  if (!validRows.length) {
    return;
  }

  if (validRows.length === 1) {
    map.flyTo([validRows[0].lat, validRows[0].lng], 9, { duration: 0.7 });
    return;
  }

  const bounds = L.latLngBounds(validRows.map((row) => [row.lat, row.lng]));
  map.fitBounds(bounds, {
    padding: [36, 36],
    maxZoom: 8,
  });
}

// --- Row Copy ---

function getRowPrimaryLabel(row) {
  return row.z || row.nm || row.st || row.id;
}

function getRowSecondaryLabel(row) {
  if (state.granularity === 'zip') {
    return [row.nm, row.cty, row.st].filter(Boolean).join(' · ');
  }

  const parts = [];
  const stateCoverage = formatStateCoverage(row, false);
  if (stateCoverage && state.granularity !== 'state') parts.push(stateCoverage);
  if (row._zipCount) parts.push(`${formatters.integer.format(row._zipCount)} ZIPs`);
  parts.push(`Pop ${formatters.integer.format(row.pop || 0)}`);
  return parts.join(' · ');
}

function getRowSubtitle(row) {
  if (state.granularity === 'zip') {
    return [row.cty, row.st].filter(Boolean).join(', ');
  }
  if (state.granularity === 'state') {
    return '';
  }
  return formatStateCoverage(row, true);
}

function formatStateCoverage(row, full) {
  const states = extractStates(row);
  if (!states.length) {
    return '';
  }
  if (full || states.length <= 2) {
    return states.join(', ');
  }
  return `${states[0]} +${states.length - 1} more`;
}

function extractStates(row) {
  if (Array.isArray(row.sts) && row.sts.length) {
    return row.sts;
  }
  if (row.st) {
    return [row.st];
  }
  return [];
}

function countCoveredStates(rows) {
  const states = new Set();
  rows.forEach((row) => {
    extractStates(row).forEach((stateName) => states.add(stateName));
  });
  return states.size;
}

// --- Utilities ---

function getOverallMetricStats(metricId) {
  return meta && meta.datasets && meta.datasets[state.granularity] && meta.datasets[state.granularity].metrics
    ? meta.datasets[state.granularity].metrics[metricId]
    : null;
}

function computeMetricStats(rows, metric) {
  const values = rows
    .map((row) => row[metric.key])
    .filter((value) => value != null && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (!values.length) {
    return null;
  }

  return {
    min: values[0],
    max: values[values.length - 1],
    p05: pickQuantile(values, 0.05),
    p50: pickQuantile(values, 0.5),
    p95: pickQuantile(values, 0.95),
  };
}

function pickQuantile(values, quantile) {
  if (!values.length) {
    return 0;
  }
  const index = Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * quantile)));
  return values[index];
}

function normalizeMetricValue(value, metric, stats) {
  if (value == null || !stats) {
    return 0;
  }

  if (metric.scaleMode === 'log') {
    const minValue = Math.max(stats.p05 || stats.min || 1, 1);
    const maxValue = Math.max(stats.p95 || stats.max || minValue, minValue + 1);
    const safeValue = Math.max(value, minValue);
    const numerator = Math.log10(safeValue) - Math.log10(minValue);
    const denominator = Math.log10(maxValue) - Math.log10(minValue);
    return clamp(denominator <= 0 ? 0.4 : numerator / denominator, 0.08, 1);
  }

  const minValue = stats.p05 != null ? stats.p05 : stats.min != null ? stats.min : 0;
  const maxValue = stats.p95 != null ? stats.p95 : stats.max != null ? stats.max : minValue + 1;
  return clamp((value - minValue) / Math.max(maxValue - minValue, 0.0001), 0.08, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatMetricValue(metric, value) {
  if (value == null || Number.isNaN(value)) {
    return 'No data';
  }

  if (metric.format === 'currency') {
    return formatters.currency.format(value);
  }

  if (metric.format === 'percent') {
    return `${formatters.percent.format(value)}%`;
  }

  if (metric.format === 'decimal') {
    return formatters.decimal.format(value);
  }

  return formatters.integer.format(value);
}

function formatGeneratedAt(value) {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

function setLoading(active, message = '') {
  refs.loading.classList.toggle('hidden', !active);
  refs.loading.querySelector('p').textContent = message;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value == null ? '' : value);
}
