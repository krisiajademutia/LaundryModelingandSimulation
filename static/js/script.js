// ══════════════════════════════════════════════════════
//  LAUNDROMAT SIMULATION ENGINE (JS PORT OF SIMPY)
// ══════════════════════════════════════════════════════

// ── CONFIGURATION & STATE ────────────────────────────
let CFG = {
  nWash: 6, nDry: 8, nFold: 3, nSoap: 2,
  washTime: 35, dryMean: 52, drySd: 6,
  foldMean: 8, foldSd: 2.5,
  detMin: 1, detMax: 3, loadMin: 2, loadMax: 3, transMin: 0, transMax: 5,
  maxLoads: 3,
  arrNormal: 0.06, arrPeak: 0.15,
  peakWindows: [[60, 180], [300, 420]], // 9-11am & 1-3pm
  simDur: 720, // 8am to 8pm
};

const SCENARIOS = {
  base:     { nWash: 6, nDry: 8, nFold: 3, nSoap: 2, arrPeak: 0.15 },
  moredry:  { nWash: 6, nDry: 12, nFold: 3, nSoap: 2, arrPeak: 0.15 },
  balanced: { nWash: 8, nDry: 8, nFold: 3, nSoap: 2, arrPeak: 0.15 },
  peak:     { nWash: 6, nDry: 8, nFold: 3, nSoap: 2, arrPeak: 0.25 },
  optimal:  { nWash: 8, nDry: 10, nFold: 4, nSoap: 3, arrPeak: 0.15 },
};

let simTime = 0, isRunning = false, animId = null, lastRealTime = null;
let eventQueue = [], customers = [];
let stats = { waited: [], served: 0, arrivals: 0, peakDryQ: 0 };
let tsT = [], tsWQ = [], tsDQ = [], tsWU = [], tsDU = [];
let washRes, dryRes, foldRes, soapRes;
let custIdCounter = 0;
let compResults = {};
let speedMult = 8;
let currentScen = 'base';

// Chart instances
let chartQ, chartU;

// ── RANDOM MATH ──────────────────────────────────────
let masterSeed = Math.floor(Math.random() * 1000000); // Generates a new random day every page refresh
let seed = masterSeed;
function seededRandom() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const randExp = rate => -Math.log(1 - seededRandom()) / rate;
const randUniform = (a, b) => a + seededRandom() * (b - a);
const randNormal = (mu, sd) => {
  let u = seededRandom(), v = seededRandom();
  while (u === 0) u = seededRandom();
  while (v === 0) v = seededRandom();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── SIMULATION PRIMITIVES ────────────────────────────
function makeResource(cap) {
  return { cap, count: 0, queue: [] };
}

function requestRes(res) {
  const token = { granted: false, resolve: null };
  if (res.count < res.cap) {
    res.count++;
    token.granted = true;
  } else {
    res.queue.push(token);
  }
  return token;
}

function releaseRes(res, token) {
  res.count--;
  if (res.queue.length > 0) {
    const next = res.queue.shift();
    next.granted = true;
    res.count++;
    if (next.onGrant) next.onGrant();
  }
}

function schedule(time, type, data = {}) {
  eventQueue.push({ time, type, data });
  eventQueue.sort((a, b) => a.time - b.time);
}

let pregenTraffic = [];

// ── CUSTOMER LIFECYCLE ───────────────────────────────
function handleEvent(ev) {
  simTime = ev.time;
  const c = customers.find(x => x.id === ev.data.cid);
  if (!c && ev.type !== 'arrival') return;

  switch (ev.type) {
    case 'arrival':
      const pIdx = ev.data.pIdx;
      const pc = pregenTraffic[pIdx];
      const newCust = {
        id: pc.id, arrTime: simTime, nLoads: pc.nLoads, state: 'arriving',
        dryQEntry: null, firstDryStart: null,
        tokensW: [], tokensD: [], tokenF: null, pc: pc
      };
      customers.push(newCust);
      stats.arrivals++;
      logMsg(simTime, `#${newCust.id} arrives (${newCust.nLoads} load${newCust.nLoads > 1 ? 's' : ''})`, 'ok');
      
      newCust.state = 'soap-q';
      const tkS = requestRes(soapRes);
      if (tkS.granted) schedule(simTime, 'soap-start', { cid: newCust.id });
      else {
        tkS.onGrant = () => schedule(simTime, 'soap-start', { cid: newCust.id });
      }

      if (pIdx + 1 < pregenTraffic.length) {
        schedule(pregenTraffic[pIdx + 1].t, 'arrival', { pIdx: pIdx + 1 });
      }
      break;

    case 'soap-start':
      c.state = 'soap';
      schedule(simTime + c.pc.sDur, 'soap-done', { cid: c.id });
      break;

    case 'soap-done':
      releaseRes(soapRes, {});
      c.state = 'wash-q';
      c.washQEntry = simTime;
      c.tokensW = [];
      const checkW = () => { if (c.tokensW.every(t => t.granted)) schedule(simTime, 'wash-start', { cid: c.id }); };
      for (let i = 0; i < c.nLoads; i++) {
        let tk = requestRes(washRes);
        tk.onGrant = checkW;
        c.tokensW.push(tk);
      }
      checkW();
      break;

    case 'wash-start':
      c.state = 'washing';
      const wWait = simTime - c.washQEntry;
      stats.waitedW.push(wWait);
      schedule(simTime + c.pc.loadStag + CFG.washTime + c.pc.wDur, 'wash-done', { cid: c.id });
      break;

    case 'wash-done':
      c.tokensW.forEach(t => releaseRes(washRes, t));
      c.tokensW = [];
      c.state = 'transfer';
      schedule(simTime + c.pc.tDur, 'try-dry', { cid: c.id });
      break;

    case 'try-dry':
      c.state = 'dry-q';
      c.dryQEntry = simTime;
      c.tokensD = [];
      const checkD = () => { if (c.tokensD.every(t => t.granted)) schedule(simTime, 'dry-start', { cid: c.id }); };
      for (let i = 0; i < c.nLoads; i++) {
        let tk = requestRes(dryRes);
        tk.onGrant = checkD;
        c.tokensD.push(tk);
      }
      checkD();
      break;

    case 'dry-start':
      c.state = 'drying';
      const wait = simTime - c.dryQEntry;
      if (wait > stats.peakDryQ) stats.peakDryQ = wait;
      if (wait > 1) {
        stats.waited.push(wait);
        logMsg(simTime, `#${c.id} waited ${wait.toFixed(1)}m for dryer ⚠ BOTTLENECK`, 'err');
      }
      c.firstDryStart = simTime;
      schedule(simTime + c.pc.dDur, 'dry-done', { cid: c.id });
      break;

    case 'dry-done':
      c.tokensD.forEach(t => releaseRes(dryRes, t));
      c.tokensD = [];
      
      c.state = 'fold-q';
      c.tokenF = requestRes(foldRes);
      if (c.tokenF.granted) schedule(simTime, 'fold-start', { cid: c.id });
      else c.tokenF.onGrant = () => schedule(simTime, 'fold-start', { cid: c.id });
      break;

    case 'fold-start':
      c.state = 'folding';
      schedule(simTime + c.pc.fDur, 'fold-done', { cid: c.id });
      break;

    case 'fold-done':
      releaseRes(foldRes, c.tokenF);
      c.state = 'done';
      stats.served++;
      logMsg(simTime, `#${c.id} departs. Total: ${(simTime - c.arrTime).toFixed(0)}m`, 'ok');
      break;
  }
}

// ── LOGGING & FORMATTING ─────────────────────────────
function toHHMM(t) {
  const m = Math.floor(480 + t);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function logMsg(t, msg, level) {
  const el = document.getElementById('event-log');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `log-line ${level}`;
  div.innerHTML = `<span class="t">${toHHMM(t)}</span><span class="m">${msg}</span>`;
  el.appendChild(div);
  if (el.children.length > 200) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ── METRICS & CHARTS ─────────────────────────────────
function takeSnapshot() {
  if (tsT.length > 0 && simTime - tsT[tsT.length - 1] < 5) return;
  tsT.push(simTime);
  tsWQ.push(washRes.queue.length);
  tsDQ.push(dryRes.queue.length);
  tsWU.push((washRes.count / CFG.nWash) * 100);
  tsDU.push((dryRes.count / CFG.nDry) * 100);
}

function updateUI() {
  // Timeline
  document.getElementById('timeline-fill').style.width = Math.min(100, (simTime / CFG.simDur) * 100) + '%';
  document.getElementById('clock-label').textContent = toHHMM(simTime);

  // Cards
  const avgW = stats.waited.length ? (stats.waited.reduce((a, b) => a + b, 0) / stats.waited.length).toFixed(1) : '0.0';
  document.getElementById('val-wait').textContent = avgW;
  document.getElementById('sub-wait').textContent = `Peak wait: ${stats.peakDryQ.toFixed(1)} min`;
  document.getElementById('card-wait').classList.toggle('warn', avgW > 10);

  const avgWW = stats.waitedW.length ? (stats.waitedW.reduce((a, b) => a + b, 0) / stats.waitedW.length).toFixed(1) : '0.0';
  const elWaitWash = document.getElementById('val-wait-wash');
  if (elWaitWash) {
    elWaitWash.textContent = avgWW;
    document.getElementById('sub-wait-wash').textContent = `Washer queue: ${washRes.queue.length}`;
    document.getElementById('card-wait-wash').classList.toggle('warn', avgWW > 10);
  }

  const wUtil = Math.round((washRes.count / CFG.nWash) * 100);
  document.getElementById('val-wash').textContent = wUtil;
  document.getElementById('sub-wash').textContent = `${washRes.count} / ${CFG.nWash} Running`;

  const dUtil = Math.round((dryRes.count / CFG.nDry) * 100);
  document.getElementById('val-dry').textContent = dUtil;
  document.getElementById('sub-dry').textContent = `${dryRes.count} / ${CFG.nDry} Running`;
  document.getElementById('card-dry').classList.toggle('warn', dUtil > 90);

  document.getElementById('val-thru').textContent = stats.served;
  document.getElementById('sub-thru').textContent = `${stats.arrivals} arrivals today`;

  // Charts
  if (chartQ && tsT.length % 2 === 0) {
    chartQ.data.labels = tsT.map(toHHMM);
    chartQ.data.datasets[0].data = tsWQ;
    chartQ.data.datasets[1].data = tsDQ;
    chartQ.update('none');

    chartU.data.labels = tsT.map(toHHMM);
    chartU.data.datasets[0].data = tsWU;
    chartU.data.datasets[1].data = tsDU;
    chartU.update('none');
  }
}

function updateCompTable(scenKey) {
  const avgW = stats.waited.length ? (stats.waited.reduce((a, b) => a + b, 0) / stats.waited.length).toFixed(1) : '0.0';
  const avgWW = stats.waitedW.length ? (stats.waitedW.reduce((a, b) => a + b, 0) / stats.waitedW.length).toFixed(1) : '0.0';
  const peak = Math.max(0, ...tsDQ);
  const thru = stats.arrivals ? ((stats.served / stats.arrivals) * 100).toFixed(1) : '0.0';
  const dUtilAvg = tsDU.length ? (tsDU.reduce((a, b) => a + b, 0) / tsDU.length).toFixed(0) : '0';
  
  compResults[scenKey] = { avgW, avgWW, peak, thru, dUtilAvg };

  const tbody = document.getElementById('cmp-body');
  tbody.innerHTML = '';
  
  const scenNames = {
    base: 'Baseline 6W/8D',
    moredry: 'More Dryers 6W/12D',
    balanced: 'Balanced 8W/8D',
    peak: 'Peak Stress',
    optimal: 'Optimal 8W/10D'
  };

  const bestW = Math.min(...Object.values(compResults).map(r => parseFloat(r.avgW)));
  
  Object.keys(compResults).forEach(k => {
    const r = compResults[k];
    const tr = document.createElement('tr');
    if (k === scenKey) tr.className = 'active-row';
    const wCls = parseFloat(r.avgW) === bestW ? 'val-best' : (parseFloat(r.avgW) > 15 ? 'val-worst' : '');
    tr.innerHTML = `
      <td>${scenNames[k] || k}</td>
      <td class="${wCls}">${r.avgW} min</td>
      <td>${r.avgWW || '0.0'} min</td>
      <td>${r.peak} loads</td>
      <td>${r.thru}%</td>
      <td>${r.dUtilAvg}%</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── CANVAS FLOOR MAP ─────────────────────────────────
const C_COLS = {
  'arriving':'#8B5CF6','soap-q':'#8B5CF6','soap':'#8B5CF6','wash-q':'#8B5CF6',
  'washing':'#3B82F6','transfer':'#3B82F6',
  'dry-q':'#EF4444','drying':'#F59E0B','fold-q':'#F59E0B',
  'folding':'#10B981'
};

function drawFloor() {
  const canvas = document.getElementById('floor-canvas');
  if (!canvas) return;
  const p = canvas.parentNode;
  const W = p.clientWidth, H = p.clientHeight || 250;
  canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0,0,W,H);

  const sw = Math.floor(W / 4) - 10;
  
  function drawArea(x, name, count, cap, qLen, accent) {
    ctx.fillStyle = qLen > 0 ? accent : '#9CA3AF';
    ctx.font = '600 11px Outfit';
    ctx.fillText(`${name} [Q:${qLen}]`, x, 20);

    const rW = Math.min(24, (sw - 15) / 3);
    for (let i = 0; i < cap; i++) {
      const isBusy = i < count;
      const bx = x + (i % 3) * (rW + 5);
      const by = 35 + Math.floor(i / 3) * (rW + 5);
      
      ctx.fillStyle = isBusy ? accent + '33' : 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = isBusy ? accent : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, rW, rW, 4); ctx.fill(); ctx.stroke();
      
      if (isBusy) {
        ctx.beginPath();
        ctx.arc(bx + rW/2, by + rW/2, rW/2 - 4, -Math.PI/2, -Math.PI/2 + (Math.PI*2 * ((simTime % 30)/30)));
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
      }
    }
  }

  drawArea(10, 'SOAP', soapRes.count, CFG.nSoap, soapRes.queue.length, '#8B5CF6');
  drawArea(sw + 20, 'WASH', washRes.count, CFG.nWash, washRes.queue.length, '#3B82F6');
  
  if (dryRes.queue.length > 0) {
    ctx.fillStyle = 'rgba(239,68,68,0.05)';
    ctx.roundRect(sw*2 + 25, 5, sw + 10, H - 10, 8);
    ctx.fill();
  }
  drawArea(sw*2 + 30, 'DRY', dryRes.count, CFG.nDry, dryRes.queue.length, '#EF4444');
  drawArea(sw*3 + 40, 'FOLD', foldRes.count, CFG.nFold, foldRes.queue.length, '#10B981');

  // Draw active customers (dots at bottom)
  const active = customers.filter(c => c.state !== 'done').slice(-60);
  active.forEach((c, i) => {
    const col = C_COLS[c.state] || '#6B7280';
    let cx = 0;
    if (['arriving','soap-q','soap','wash-q'].includes(c.state)) cx = 10;
    else if (['washing','transfer'].includes(c.state)) cx = sw + 20;
    else if (['dry-q','drying'].includes(c.state)) cx = sw*2 + 30;
    else cx = sw*3 + 40;
    
    ctx.beginPath();
    ctx.arc(cx + (i % 10) * 8, H - 15 - Math.floor(i / 10) * 8, 3, 0, Math.PI*2);
    ctx.fillStyle = col;
    ctx.fill();
  });
}

// ── ENGINE LOOP ──────────────────────────────────────
function initCharts() {
  if (chartQ) chartQ.destroy();
  if (chartU) chartU.destroy();
  
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { labels: { color: '#9CA3AF', font: { family: 'Outfit', size: 11 } } } },
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9CA3AF' } }
    }
  };
  
  chartQ = new Chart(document.getElementById('chart-queue').getContext('2d'), {
    type: 'line', options: JSON.parse(JSON.stringify(opts)),
    data: { labels: [], datasets: [
      { label: 'Washer Queue', data: [], borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, pointRadius: 0, tension: 0.4 },
      { label: 'Dryer Queue', data: [], borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, pointRadius: 0, tension: 0.4 }
    ]}
  });

  const optsU = JSON.parse(JSON.stringify(opts));
  optsU.scales.y.max = 110;
  chartU = new Chart(document.getElementById('chart-util').getContext('2d'), {
    type: 'line', options: optsU,
    data: { labels: [], datasets: [
      { label: 'Washer %', data: [], borderColor: '#3B82F6', pointRadius: 0, tension: 0.4 },
      { label: 'Dryer %', data: [], borderColor: '#F59E0B', pointRadius: 0, tension: 0.4 }
    ]}
  });
}

function resetSim() {
  isRunning = false;
  if (animId) cancelAnimationFrame(animId);
  
  simTime = 0; eventQueue = []; customers = [];
  seed = masterSeed; // Force identical traffic across scenarios for this specific page load
  stats = { waited: [], waitedW: [], served: 0, arrivals: 0, peakDryQ: 0 };
  tsT = []; tsWQ = []; tsDQ = []; tsWU = []; tsDU = [];
  
  // PREGENERATE ALL TRAFFIC AND DURATIONS
  pregenTraffic = [];
  let t = 0; let cid = 0;
  while (t < CFG.simDur) {
    cid++;
    const rate = CFG.peakWindows.some(([l, h]) => t >= l && t <= h) ? CFG.arrPeak : CFG.arrNormal;
    t += randExp(rate);
    if (t >= CFG.simDur) break;
    let nLoads = Math.floor(randUniform(1, CFG.maxLoads + 1));
    pregenTraffic.push({ id: cid, t, nLoads, 
      wDur: randUniform(-1, 1), dDur: clamp(randNormal(CFG.dryMean, CFG.drySd), 45, 62),
      fDur: Math.max(3, randNormal(CFG.foldMean * nLoads, CFG.foldSd)),
      sDur: randUniform(CFG.detMin, CFG.detMax), tDur: randUniform(CFG.transMin, CFG.transMax),
      loadStag: randUniform(CFG.loadMin, CFG.loadMax)
    });
  }
  if (pregenTraffic.length > 0) schedule(pregenTraffic[0].t, 'arrival', { pIdx: 0 });
  
  CFG.nWash = parseInt(document.getElementById('n-wash').value);
  CFG.nDry = parseInt(document.getElementById('n-dry').value);
  CFG.nFold = parseInt(document.getElementById('n-fold').value);
  CFG.nSoap = parseInt(document.getElementById('n-soap').value);

  washRes = makeResource(CFG.nWash);
  dryRes = makeResource(CFG.nDry);
  foldRes = makeResource(CFG.nFold);
  soapRes = makeResource(CFG.nSoap);

  document.getElementById('event-log').innerHTML = '';
  document.getElementById('btn-run-text').textContent = 'Start Simulation';
  
  initCharts(); updateUI(); drawFloor();
}

function simStep(delta) {
  if (!isRunning) return;
  const targetTime = Math.min(simTime + delta * speedMult, CFG.simDur);
  let steps = 0;
  
  while (eventQueue.length > 0 && eventQueue[0].time <= targetTime && steps < 1000) {
    handleEvent(eventQueue.shift());
    steps++;
  }
  
  simTime = targetTime;
  takeSnapshot();
  
  if (steps > 0 || seededRandom() < 0.1) {
    drawFloor();
    updateUI();
  }

  if (simTime >= CFG.simDur) {
    isRunning = false;
    updateUI(); drawFloor();
    updateCompTable(currentScen);
    logMsg(simTime, `--- SIMULATION FINISHED ---`, 'ok');
    document.getElementById('btn-run-text').textContent = 'Restart';
  }
}

function loop(ts) {
  if (!isRunning) return;
  const delta = lastRealTime ? Math.min((ts - lastRealTime) / 1000, 0.1) : 0.016;
  lastRealTime = ts;
  simStep(delta);
  animId = requestAnimationFrame(loop);
}

window.toggleSim = function() {
  if (simTime >= CFG.simDur) resetSim();
  isRunning = !isRunning;
  document.getElementById('btn-run-text').textContent = isRunning ? 'Pause' : 'Resume';
  if (isRunning) { lastRealTime = null; animId = requestAnimationFrame(loop); }
};

window.resetSim = resetSim;

window.loadScen = function(key) {
  document.getElementById('scen-custom').style.display = 'none';
  document.querySelectorAll('.scen-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('scen-' + key).classList.add('active');
  currentScen = key;
  const s = SCENARIOS[key];
  document.getElementById('n-wash').value = s.nWash;
  document.getElementById('n-dry').value = s.nDry;
  document.getElementById('n-fold').value = s.nFold;
  document.getElementById('n-soap').value = s.nSoap;
  CFG.arrPeak = s.arrPeak;
  resetSim();
};

document.getElementById('speed').addEventListener('input', e => {
  speedMult = parseInt(e.target.value);
  document.getElementById('speed-val').textContent = speedMult + 'x';
});

// Boot
['n-wash', 'n-dry', 'n-fold', 'n-soap'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    const w = parseInt(document.getElementById('n-wash').value);
    const d = parseInt(document.getElementById('n-dry').value);
    const f = parseInt(document.getElementById('n-fold').value);
    const s = parseInt(document.getElementById('n-soap').value);
    
    let matchedKey = null;
    for (const [k, v] of Object.entries(SCENARIOS)) {
      if (v.nWash === w && v.nDry === d && v.nFold === f && v.nSoap === s) {
        matchedKey = k; break;
      }
    }
    
    document.querySelectorAll('.scen-btn').forEach(b => b.classList.remove('active'));
    if (matchedKey) {
      document.getElementById('scen-custom').style.display = 'none';
      document.getElementById('scen-' + matchedKey).classList.add('active');
      currentScen = matchedKey;
    } else {
      document.getElementById('scen-custom').style.display = 'flex';
      document.getElementById('scen-custom').classList.add('active');
      document.getElementById('custom-desc').textContent = `${w}W / ${d}D`;
      currentScen = `Custom ${w}W/${d}D`;
    }
    resetSim();
  });
});

window.addEventListener('resize', drawFloor);
resetSim();
