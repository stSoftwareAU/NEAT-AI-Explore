/**
 * NEAT-AI Explore - Neuron Network Explorer
 * 
 * Left-to-right exploration: current neuron on left, inbound synapses on right.
 * Click a synapse to navigate upstream toward inputs.
 * 
 * Terminology (consistent with NEAT-AI):
 * - Neurons: hidden + output neurons (not inputs)
 * - Observations: input observations
 * - Synapses: connections between neurons
 */

let SNAPSHOT = null;
let synapses = [];
let neuronsByUuid = new Map();
let trace = []; // Array of neuron UUIDs
let aliasToUuid = {};  // "human-name" -> "input-N"
let uuidToAlias = {};  // "input-N" -> "human-name"

// Thresholds for highlighting
const IMPACT_HIGHLIGHT_THRESHOLD = 0.1;      // Highlight if impact > 0.1
const IMPACT_SUSPICIOUS_THRESHOLD = 1e-8;    // Suspiciously low - should be prunable
const MSE_ERROR_THRESHOLD = 0.3;             // Highlight if MSE > 0.3

// Tooltips for property labels
const TOOLTIPS = {
  'Type': 'Neuron type: input, hidden, output, or constant',
  'Squash': 'Activation function applied to the weighted sum of inputs',
  'Bias': 'Constant value added before the activation function',
  'Impact': 'Fraction of influence this neuron has on the final output (0-1). Values < 1e-8 are suspiciously low and should be prunable.',
  'Mean Activation': 'Average output value across all samples',
  'Activation Range': 'Minimum and maximum activation values observed',
  'MAE': 'Mean Absolute Error - used in focus neuron ranking',
  'MSE': 'Mean Squared Error - matches production creature scoring',
  'Samples': 'Number of observations recorded for this neuron',
  'Max Recon Δ': 'Maximum reconstruction delta - largest difference between recorded activation and recomputed activation from inputs. High values suggest recording or squash function issues.',
};

const el = {
  fetchUrl: document.getElementById('fetchUrl'),
  fetchBtn: document.getElementById('fetchBtn'),
  fileInput: document.getElementById('fileInput'),
  fileBtn: document.getElementById('fileBtn'),
  status: document.getElementById('status'),
  traceBreadcrumb: document.getElementById('traceBreadcrumb'),
  traceBackBtn: document.getElementById('traceBackBtn'),
  traceClearBtn: document.getElementById('traceClearBtn'),
  currentNeuronTitle: document.getElementById('currentNeuronTitle'),
  neuronProps: document.getElementById('neuronProps'),
  synapseCount: document.getElementById('synapseCount'),
  synapseSort: document.getElementById('synapseSort'),
  synapseListContainer: document.getElementById('synapseListContainer'),
};

// ============================================================================
// Aliases
// ============================================================================

async function loadAliases() {
  try {
    const res = await fetch('./aliases.json', { cache: 'no-store' });
    if (!res.ok) return;
    aliasToUuid = await res.json();
    uuidToAlias = {};
    for (const [name, uuid] of Object.entries(aliasToUuid)) {
      uuidToAlias[uuid] = name;
    }
    console.log(`Loaded ${Object.keys(uuidToAlias).length} aliases`);
  } catch (e) {
    console.warn('Could not load aliases.json:', e.message);
  }
}

function getAlias(uuid) {
  return uuidToAlias[uuid] ?? null;
}

// ============================================================================
// Status & Loading
// ============================================================================

function setStatus(msg, kind = '') {
  el.status.textContent = msg;
  el.status.className = 'statusInline ' + kind;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normaliseCreature(snapshot) {
  const creature = snapshot?.creature ?? snapshot?.creatureJson;
  if (!creature) throw new Error('No creature in snapshot');

  const rawSynapses = creature.synapses ?? [];
  synapses = rawSynapses.map(s => {
    const fromUuid = s.fromUuid ?? s.fromUUID ?? s.from_uuid;
    const toUuid = s.toUuid ?? s.toUUID ?? s.to_uuid;
    const weight = s.weight;
    if (!fromUuid || !toUuid || typeof weight !== 'number') return null;
    return { fromUuid, toUuid, weight };
  }).filter(Boolean);

  const rawNeurons = creature.neurons ?? [];
  neuronsByUuid = new Map(rawNeurons.map(n => [n.uuid, n]));

  const inputCount = creature.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    const uuid = `input-${i}`;
    if (!neuronsByUuid.has(uuid)) {
      neuronsByUuid.set(uuid, { uuid, type: 'input', squash: 'IDENTITY', bias: 0 });
    }
  }

  return creature;
}

async function loadSnapshot(source, label) {
  try {
    setStatus(`Loading ${label}...`);
    const obj = typeof source === 'string' ? await fetchJson(source) : source;
    SNAPSHOT = obj;
    const creature = normaliseCreature(obj);

    const neuronCount = (creature.neurons ?? []).filter(n => n.type !== 'input').length;
    const inputCount = creature.input ?? 0;
    
    setStatus(`Observations: ${inputCount.toLocaleString()}, Neurons: ${neuronCount.toLocaleString()} & Synapses: ${synapses.length.toLocaleString()}`, 'ok');

    const outputs = (creature.neurons ?? []).filter(n => n.type === 'output');
    const startUuid = outputs[0]?.uuid ?? 'output-0';
    
    trace = [];
    navigateTo(startUuid);
  } catch (e) {
    setStatus(e.message, 'bad');
    console.error(e);
  }
}

// ============================================================================
// Data Accessors
// ============================================================================

function getImpacts() {
  const derived = SNAPSHOT?.derived;
  return derived?.impactsByNeuronUuid ?? derived?.impacts_by_neuron_uuid ?? {};
}

function getNeuronImpact(uuid) {
  return getImpacts()[uuid] ?? null;
}

function getNeuronStats(uuid) {
  return SNAPSHOT?.recording?.neurons?.[uuid]?.stats ?? null;
}

// Get MSE - matches production creature scoring
function getMSE(uuid) {
  const stats = getNeuronStats(uuid);
  return stats?.meanSquaredError ?? stats?.mean_squared_error ?? null;
}

// Get MAE - used in focus neuron ranking  
function getMAE(uuid) {
  const stats = getNeuronStats(uuid);
  return stats?.meanAbsoluteError ?? stats?.mean_absolute_error ?? null;
}

function getMeanContribution(fromUuid, toUuid) {
  const key = `${fromUuid}→${toUuid}`;
  const synData = SNAPSHOT?.derived?.synapses?.[key];
  return synData?.stats?.meanContribution ?? synData?.stats?.mean_contribution ?? null;
}

function getReconstructionCheck(uuid) {
  const reconChecks = SNAPSHOT?.derived?.reconstructionChecks ?? SNAPSHOT?.derived?.reconstruction_checks ?? [];
  return reconChecks.find(c => (c.neuronUuid ?? c.neuron_uuid) === uuid) ?? null;
}

// ============================================================================
// Navigation
// ============================================================================

function navigateTo(uuid) {
  if (!neuronsByUuid.has(uuid) && !uuid.startsWith('input-')) {
    setStatus(`Unknown neuron: ${uuid}`, 'bad');
    return;
  }

  const existingIndex = trace.indexOf(uuid);
  if (existingIndex >= 0) {
    trace = trace.slice(0, existingIndex + 1);
  } else {
    trace.push(uuid);
  }

  renderTrace();
  renderCurrentNeuron(uuid);
  renderSynapseList(uuid);
}

function goBack() {
  if (trace.length > 1) {
    trace.pop();
    const uuid = trace[trace.length - 1];
    renderTrace();
    renderCurrentNeuron(uuid);
    renderSynapseList(uuid);
  }
}

function clearTrace() {
  if (trace.length > 0) {
    const first = trace[0];
    trace = [first];
    renderTrace();
  }
}

// ============================================================================
// Render Functions
// ============================================================================

function renderTrace() {
  el.traceBreadcrumb.innerHTML = '';
  
  trace.forEach((uuid) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = truncateNeuronName(uuid);
    btn.title = uuid + (getAlias(uuid) ? ` (${getAlias(uuid)})` : '');
    btn.onclick = () => navigateTo(uuid);
    li.appendChild(btn);
    el.traceBreadcrumb.appendChild(li);
  });
}

function truncateUuid(uuid) {
  if (uuid.length <= 16) return uuid;
  return uuid.slice(0, 8) + '…' + uuid.slice(-4);
}

function truncateNeuronName(uuid) {
  const alias = getAlias(uuid);
  if (alias) {
    return alias.length > 20 ? alias.slice(0, 18) + '…' : alias;
  }
  return truncateUuid(uuid);
}

function getImpactClass(impact) {
  if (impact == null) return '';
  if (impact > IMPACT_HIGHLIGHT_THRESHOLD) return 'highlight';
  if (impact < IMPACT_SUSPICIOUS_THRESHOLD && impact >= 0) return 'suspicious';
  return '';
}

function renderCurrentNeuron(uuid) {
  const n = neuronsByUuid.get(uuid) ?? { uuid, type: 'input', squash: 'IDENTITY', bias: 0 };
  const alias = getAlias(uuid);
  const isInput = uuid.startsWith('input-');
  
  if (alias) {
    el.currentNeuronTitle.innerHTML = `<span class="aliasName">${alias}</span><span class="uuidSmall">${uuid}</span>`;
  } else {
    el.currentNeuronTitle.textContent = uuid;
  }

  const stats = getNeuronStats(uuid);
  const impact = getNeuronImpact(uuid);
  const check = getReconstructionCheck(uuid);

  const props = [];
  props.push(['Type', n.type ?? 'unknown']);

  // Only show squash/bias for non-input neurons (inputs don't have these)
  if (!isInput) {
    props.push(['Squash', n.squash ?? 'IDENTITY']);
    props.push(['Bias', formatNumber(n.bias)]);
  }
  
  if (impact != null) {
    const impactClass = getImpactClass(impact);
    const impactNote = impact < IMPACT_SUSPICIOUS_THRESHOLD ? ' ⚠️' : '';
    props.push(['Impact', formatSig(impact, 3) + impactNote, impactClass]);
  }

  if (stats) {
    props.push(['Mean Activation', formatNumber(stats.meanActivation)]);
    props.push(['Activation Range', `${formatNumber(stats.activationMin)} → ${formatNumber(stats.activationMax)}`]);
    
    // Only show error for non-input neurons
    if (!isInput) {
      const mse = stats.meanSquaredError ?? stats.mean_squared_error;
      const mae = stats.meanAbsoluteError ?? stats.mean_absolute_error;
      if (mse != null) {
        const errorClass = mse > MSE_ERROR_THRESHOLD ? 'error' : '';
        props.push(['MSE', formatSig(mse, 3), errorClass]);
      }
      if (mae != null) {
        props.push(['MAE', formatSig(mae, 3)]);
      }
    }
    props.push(['Samples', stats.recordCount ?? 'N/A']);
  }

  if (!isInput && check) {
    const maxDelta = check.maxActivationDelta ?? check.max_activation_delta;
    const deltaClass = maxDelta > 0.01 ? 'error' : '';
    props.push(['Max Recon Δ', formatSig(maxDelta, 3), deltaClass]);
  }

  el.neuronProps.innerHTML = '';
  props.forEach(([label, value, cls]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    if (TOOLTIPS[label]) {
      dt.title = TOOLTIPS[label];
      dt.classList.add('hasTooltip');
    }
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (cls) dd.className = cls;
    el.neuronProps.appendChild(dt);
    el.neuronProps.appendChild(dd);
  });
}

function getInboundSynapses(toUuid) {
  return synapses.filter(s => s.toUuid === toUuid);
}

function renderSynapseList(toUuid) {
  const inbound = getInboundSynapses(toUuid);
  el.synapseCount.textContent = inbound.length;

  if (inbound.length === 0) {
    el.synapseListContainer.innerHTML = `
      <div class="emptyState">
        ${toUuid.startsWith('input-') ? 'This is an observation (no inbound synapses)' : 'No inbound synapses found'}
      </div>
    `;
    return;
  }

  const enriched = inbound.map(syn => {
    const impact = getNeuronImpact(syn.fromUuid);
    const mse = getMSE(syn.fromUuid);
    const contrib = getMeanContribution(syn.fromUuid, syn.toUuid);
    const alias = getAlias(syn.fromUuid);
    const isInput = syn.fromUuid.startsWith('input-');
    return { ...syn, impact, mse, contrib, alias, isInput };
  });

  const sortKey = el.synapseSort.value;
  enriched.sort((a, b) => {
    switch (sortKey) {
      case 'weight':
        return b.weight - a.weight;
      case 'absWeight':
        return Math.abs(b.weight) - Math.abs(a.weight);
      case 'absContribution':
        return Math.abs(b.contrib ?? 0) - Math.abs(a.contrib ?? 0);
      case 'impact':
        return (b.impact ?? 0) - (a.impact ?? 0);
      case 'impactAsc':
        return (a.impact ?? 0) - (b.impact ?? 0);
      case 'mse':
        return (b.mse ?? 0) - (a.mse ?? 0);
      default:
        return Math.abs(b.weight) - Math.abs(a.weight);
    }
  });

  el.synapseListContainer.innerHTML = '';
  
  enriched.forEach(syn => {
    const row = document.createElement('div');
    row.className = 'synapseRow';
    if (trace.includes(syn.fromUuid)) {
      row.classList.add('inTrace');
    }
    if (syn.impact != null && syn.impact < IMPACT_SUSPICIOUS_THRESHOLD && syn.impact >= 0) {
      row.classList.add('suspicious');
    }

    const fromNeuron = neuronsByUuid.get(syn.fromUuid);
    const fromType = fromNeuron?.type ?? (syn.isInput ? 'input' : 'hidden');

    let nameHtml;
    if (syn.alias) {
      nameHtml = `
        <span class="neuronAlias">${syn.alias}</span>
        <span class="neuronUuidSmall">${syn.fromUuid}</span>
      `;
    } else {
      nameHtml = `<span class="neuronUuid">${syn.fromUuid}</span>`;
    }

    const statsHtml = [];
    statsHtml.push(`<span class="stat ${syn.weight >= 0 ? 'positive' : 'negative'}" title="Weight: strength of connection">w: ${formatNumber(syn.weight)}</span>`);
    
    if (syn.impact != null) {
      const impactClass = getImpactClass(syn.impact);
      const impactNote = syn.impact < IMPACT_SUSPICIOUS_THRESHOLD ? ' ⚠️' : '';
      const tooltip = syn.impact < IMPACT_SUSPICIOUS_THRESHOLD 
        ? 'Impact < 1e-8: suspiciously low - should be prunable'
        : 'Impact: fraction of influence on output (0-1)';
      statsHtml.push(`<span class="stat ${impactClass}" title="${tooltip}">imp: ${formatSig(syn.impact, 3)}${impactNote}</span>`);
    }
    
    if (syn.contrib != null) {
      statsHtml.push(`<span class="stat" title="Contribution: activation × weight">c: ${formatSig(syn.contrib, 3)}</span>`);
    }
    
    if (!syn.isInput && syn.mse != null) {
      const errorClass = syn.mse > MSE_ERROR_THRESHOLD ? 'error' : '';
      statsHtml.push(`<span class="stat ${errorClass}" title="Mean Squared Error - matches production">mse: ${formatSig(syn.mse, 3)}</span>`);
    }

    row.innerHTML = `
      <div class="synapseFrom">
        ${nameHtml}
        <span class="neuronType">${fromType}</span>
      </div>
      <div class="synapseStats">${statsHtml.join('')}</div>
      <div class="synapseNav">→</div>
    `;

    row.onclick = () => navigateTo(syn.fromUuid);
    el.synapseListContainer.appendChild(row);
  });
}

function formatNumber(n, decimals = 4) {
  if (n == null || typeof n !== 'number') return 'N/A';
  if (!isFinite(n)) return String(n);
  return n.toFixed(decimals);
}

function formatSig(n, sigFigs = 3) {
  if (n == null || typeof n !== 'number') return 'N/A';
  if (!isFinite(n)) return String(n);
  if (n === 0) return '0';
  
  const absN = Math.abs(n);
  if (absN < 0.001 || absN >= 10000) {
    return n.toExponential(sigFigs - 1);
  }
  return Number(n.toPrecision(sigFigs)).toString();
}

// ============================================================================
// Event Listeners
// ============================================================================

el.fetchBtn.onclick = () => {
  const url = el.fetchUrl.value.trim() || './snapshot.json';
  loadSnapshot(url, url);
};

el.fileBtn.onclick = () => el.fileInput.click();

el.fileInput.onchange = async () => {
  const file = el.fileInput.files?.[0];
  if (!file) return;
  try {
    setStatus(`Reading ${file.name}...`);
    const text = await file.text();
    const obj = JSON.parse(text);
    await loadSnapshot(obj, file.name);
  } catch (e) {
    setStatus(e.message, 'bad');
  }
};

el.traceBackBtn.onclick = goBack;
el.traceClearBtn.onclick = clearTrace;

el.synapseSort.onchange = () => {
  if (trace.length > 0) {
    renderSynapseList(trace[trace.length - 1]);
  }
};

el.fetchUrl.onkeydown = (e) => {
  if (e.key === 'Enter') el.fetchBtn.click();
};

// ============================================================================
// Init
// ============================================================================

loadAliases().then(() => {
  const params = new URLSearchParams(window.location.search);
  const fileParam = params.get('file');
  if (fileParam) {
    el.fetchUrl.value = fileParam;
    loadSnapshot(fileParam, fileParam);
  } else {
    setStatus('Enter URL or browse for a snapshot JSON');
  }
});
