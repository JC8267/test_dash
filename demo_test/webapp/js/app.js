import {
  COMPARATORS,
  DEFAULT_STATE,
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

let allRows = [];
let meta = null;
let map = null;
let heatLayer = null;
let markersLayer = null;
let rowMarkerMap = new Map();
let lastFilteredRows = [];
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

    const [rows, metaResponse] = await Promise.all([
      fetchJson('./data/demos_compact.json'),
      fetchJson('./data/meta.json'),
    ]);

    allRows = rows;
    meta = metaResponse;

    hydrateMetricSelects();
    hydrateGeographySelects();
    renderPopularCuts();
    renderCuts();
    restoreFromUrl();
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
  refs.stateSelect = document.getElementById('stateSelect');
  refs.countySelect = document.getElementById('countySelect');
  refs.msaSelect = document.getElementById('msaSelect');
  refs.searchInput = document.getElementById('searchInput');
  refs.minPopulation = document.getElementById('minPopulation');
  refs.excludeZero = document.getElementById('excludeZero');
  refs.popularCuts = document.getElementById('popularCuts');
  refs.cutsList = document.getElementById('cutsList');
  refs.addCut = document.getElementById('addCutButton');
  refs.clearCuts = document.getElementById('clearCutsButton');
  refs.fitResults = document.getElementById('fitResultsButton');
  refs.exportCsv = document.getElementById('exportCsvButton');
  refs.resetAll = document.getElementById('resetAllButton');
  refs.darkToggle = document.getElementById('darkModeToggle');
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
    render();
    pushUrl();
  });

  refs.stateSelect.addEventListener('change', () => {
    state.state = refs.stateSelect.value;
    if (state.county && !getCountyOptions().includes(state.county)) {
      state.county = '';
    }
    if (state.msa && !getMsaOptions().includes(state.msa)) {
      state.msa = '';
    }
    hydrateDependentGeography();
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
    fitToRows(lastFilteredRows);
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
    const button = event.target.closest('[data-zip]');
    if (!button) {
      return;
    }

    const row = lastFilteredRows.find((entry) => entry.z === button.dataset.zip);
    if (!row) {
      return;
    }

    focusRow(row);
  });

  // Keyboard shortcuts
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
    hydrateGeographySelects();
    hydrateMetricSelects();
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
  refs.stateSelect.value = '';
  refs.countySelect.value = '';
  refs.msaSelect.value = '';
  refs.searchInput.value = '';
  refs.minPopulation.value = '';
  refs.excludeZero.checked = true;

  hydrateDependentGeography();
  renderCuts();
  render();
  pushUrl();
  showToast('All filters reset');
}

// --- CSV Export ---

function exportFilteredCsv() {
  if (!lastFilteredRows.length) {
    showToast('No results to export');
    return;
  }

  const metric = METRICS_BY_ID[state.selectedMetricId];
  const headers = ['ZIP', 'Name', 'County', 'State', 'MSA', 'Population', 'Households', metric.label];
  const csvRows = [headers.join(',')];

  for (const row of lastFilteredRows) {
    csvRows.push([
      row.z,
      csvEscape(row.nm || ''),
      csvEscape(row.cty || ''),
      row.st || '',
      csvEscape(row.msa || ''),
      row.pop || 0,
      row.hh || 0,
      row[metric.key] != null ? row[metric.key] : '',
    ].join(','));
  }

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zip_demographics_${state.selectedMetricId}_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${formatters.integer.format(lastFilteredRows.length)} rows`);
}

function csvEscape(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// --- URL State ---

function pushUrl() {
  const params = new URLSearchParams();
  if (state.selectedMetricId !== DEFAULT_STATE.selectedMetricId) params.set('metric', state.selectedMetricId);
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
  const params = new URLSearchParams(window.location.search);

  if (params.has('metric') && METRICS_BY_ID[params.get('metric')]) {
    state.selectedMetricId = params.get('metric');
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
      // Invalid cuts data, ignore
    }
  }

  // Sync UI with state
  refs.metricSelect.value = state.selectedMetricId;
  refs.searchInput.value = state.search;
  refs.minPopulation.value = state.minPopulation;
  refs.excludeZero.checked = state.excludeZero;
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

function hydrateGeographySelects() {
  populateSelect(refs.stateSelect, meta.states, 'All states', state.state);
  hydrateDependentGeography();
  refs.searchInput.value = state.search;
  refs.minPopulation.value = state.minPopulation;
  refs.excludeZero.checked = state.excludeZero;
  refs.generatedAt.textContent = formatGeneratedAt(meta.generatedAt);
}

function hydrateDependentGeography() {
  populateSelect(refs.countySelect, getCountyOptions(), 'All counties', state.county);
  populateSelect(refs.msaSelect, getMsaOptions(), 'All MSAs', state.msa);
}

function getCountyOptions() {
  if (state.state && meta.statesMeta[state.state]) {
    return meta.statesMeta[state.state].counties;
  }
  return meta.counties;
}

function getMsaOptions() {
  if (state.state && meta.statesMeta[state.state]) {
    return meta.statesMeta[state.state].msas;
  }
  return meta.msas;
}

function populateSelect(select, options, placeholder, selectedValue) {
  const items = [`<option value="">${placeholder}</option>`]
    .concat(
      options.map(
        (option) => `<option value="${escapeAttribute(option)}" ${option === selectedValue ? 'selected' : ''}>${escapeHtml(option)}</option>`
      )
    )
    .join('');

  select.innerHTML = items;
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
  const stats = meta && meta.metrics ? meta.metrics[metric.id] : null;
  if (!stats) {
    return '';
  }
  if (comparator === 'lte') {
    return stats.p50;
  }
  return stats.p50;
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
      const stats = meta && meta.metrics ? meta.metrics[metric.id] : null;
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
          <p class="cut-hint">${escapeHtml(metric.description)} ${stats ? `Typical range ${formatMetricValue(metric, stats.p05)} to ${formatMetricValue(metric, stats.p95)}.` : ''}</p>
        </article>
      `;
    })
    .join('');
}

// --- Render ---

function render() {
  if (!allRows.length || !meta) {
    return;
  }

  const metric = METRICS_BY_ID[state.selectedMetricId];
  const filteredRows = allRows.filter((row) => matchesAllFilters(row, metric));

  lastFilteredRows = filteredRows;

  updateMetricDescription(metric);
  updateLegend(metric);
  updateStatus(filteredRows);
  updateSummaryCards(filteredRows, metric);
  updateTopResults(filteredRows, metric);
  updateMap(filteredRows, metric);
}

function matchesAllFilters(row, selectedMetric) {
  if (state.excludeZero && row.pop <= 0) {
    return false;
  }

  if (state.state && row.st !== state.state) {
    return false;
  }

  if (state.county && row.cty !== state.county) {
    return false;
  }

  if (state.msa && row.msa !== state.msa) {
    return false;
  }

  const minPopulation = Number(state.minPopulation || 0);
  if (Number.isFinite(minPopulation) && minPopulation > 0 && row.pop < minPopulation) {
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

function matchesSearch(row, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [row.z, row.nm, row.cty, row.msa, row.st]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function updateMetricDescription(metric) {
  const group = GROUPS_BY_ID[metric.group];
  const stats = meta.metrics[metric.id];

  refs.metricDescription.innerHTML = `
    <span class="metric-group-label">${escapeHtml(group.label)}</span>
    <strong>${escapeHtml(metric.label)}</strong>
    <span>${escapeHtml(metric.description)}</span>
    ${stats ? `<span>Nationwide middle range: ${formatMetricValue(metric, stats.p05)} to ${formatMetricValue(metric, stats.p95)}.</span>` : ''}
  `;
}

function updateLegend(metric) {
  const stats = meta.metrics[metric.id];
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
  const statesCovered = new Set(rows.map((row) => row.st).filter(Boolean)).size;
  const population = rows.reduce((sum, row) => sum + (row.pop || 0), 0);

  refs.status.textContent = `${formatters.integer.format(rows.length)} ZIPs matched across ${formatters.integer.format(statesCovered)} states, representing ${formatters.integer.format(population)} people.`;
}

function updateSummaryCards(rows, metric) {
  const population = rows.reduce((sum, row) => sum + (row.pop || 0), 0);
  const households = rows.reduce((sum, row) => sum + (row.hh || 0), 0);
  const metricValues = rows.map((row) => row[metric.key]).filter((value) => value != null);
  const averageMetric = metricValues.length
    ? metricValues.reduce((sum, value) => sum + value, 0) / metricValues.length
    : null;
  const topRow = getTopRows(rows, metric, 1)[0] || null;

  refs.summaryCards.innerHTML = [
    buildSummaryCard('Matching ZIPs', formatters.integer.format(rows.length), `${formatters.integer.format(new Set(rows.map((row) => row.st).filter(Boolean)).size)} states in play`),
    buildSummaryCard('Population In View', formatters.integer.format(population), `${formatters.integer.format(households)} households across the current cut`),
    buildSummaryCard(`Average ${metric.shortLabel}`, averageMetric == null ? 'No data' : formatMetricValue(metric, averageMetric), 'Average across the matched ZIP set'),
    buildSummaryCard('Top ZIP', topRow ? `${topRow.z} · ${topRow.nm || topRow.cty || topRow.st}` : 'No matches', topRow ? `${formatMetricValue(metric, topRow[metric.key])} on the selected heat metric` : 'Adjust the filters to recover results'),
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

  if (!topRows.length) {
    refs.topResults.innerHTML = `
      <div class="empty-slot compact">
        <p>No ZIPs match the current geography and demographic cuts.</p>
      </div>
    `;
    return;
  }

  refs.topResults.innerHTML = topRows
    .map((row, index) => {
      const secondary = [row.nm, row.cty, row.st].filter(Boolean).join(' · ');
      return `
        <button class="result-row" type="button" data-zip="${row.z}">
          <span class="result-rank">${index + 1}</span>
          <span class="result-copy">
            <strong>${row.z}</strong>
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

function updateMap(rows, metric) {
  const stats = meta.metrics[metric.id];
  const heatPoints = [];

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

  const topRows = getTopRows(rows, metric, 20);
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
    rowMarkerMap.set(row.z, marker);
  });
}

function buildPopupContent(row, metric) {
  return `
    <div class="popup-copy">
      <p class="popup-title">${escapeHtml(row.z)} · ${escapeHtml(row.nm || row.cty || 'Selected ZIP')}</p>
      <p class="popup-subtitle">${escapeHtml([row.cty, row.st].filter(Boolean).join(', '))}</p>
      <p><strong>${escapeHtml(metric.label)}:</strong> ${escapeHtml(formatMetricValue(metric, row[metric.key]))}</p>
      <p><strong>Population:</strong> ${escapeHtml(formatters.integer.format(row.pop || 0))}</p>
      <p><strong>Households:</strong> ${escapeHtml(formatters.integer.format(row.hh || 0))}</p>
      <p><strong>MSA:</strong> ${escapeHtml(row.msa || 'Unassigned')}</p>
    </div>
  `;
}

function focusRow(row) {
  const marker = rowMarkerMap.get(row.z);
  map.flyTo([row.lat, row.lng], Math.max(map.getZoom(), 9), {
    duration: 0.8,
  });

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

// --- Utilities ---

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
