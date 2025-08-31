// bot.js

/* M/D PREMIER RISKTAKER.tz AI SUPER BOT — Finalized JS

 * Vanilla JS (IIFE), Deriv WS v3 (app_id=97447)

 * Fixes per user request:

 *  - Arming banner persists through Armed→Reappearance→Breakout→Executing; it ONLY fades

 *    after all (X) trades complete, right before the 5s/10s phase summary.

 *  - Strict two-stage signal: NEVER treat the arming tick as reappearance. Countdown

 *    ticks (6→0) decrement ONLY on non-D ticks AFTER arming and BEFORE reappearance.

 *    If D reappears on or before the 6th tick, it’s valid; then wait for the first

 *    non-D “breakout” to execute. Otherwise invalidate at 0 and return to analysis.

 *  - No random countdown: countdown is driven purely by qualifying ticks (non-D pre-reappearance).

 *  - Inputs: sanitize on change/use only (no mid-typing autocorrect).

 *  - Full V2 flow, extremes guard at arming and trigger, UI locks, SBR flows, bulk buys.

 */

(() => {

  "use strict";

  /** ----------------------------- Header offset ------------------------- */

  const header = document.getElementById('appHeader');

  const contentRoot = document.documentElement;

  function adjustHeaderOffset(){

    const h = header?.offsetHeight || 0;

    contentRoot.style.setProperty('--header-h', `${h}px`);

  }

  window.addEventListener('load', adjustHeaderOffset, { once:true });

  window.addEventListener('resize', adjustHeaderOffset);

  window.addEventListener('orientationchange', adjustHeaderOffset);

  if (window.ResizeObserver && header) new ResizeObserver(adjustHeaderOffset).observe(header);

  /** ----------------------------- Dynamic CSS for upgraded arming panel - */

  (function injectDynamicStyles(){

    const css = `

    .arming-banner { opacity:1; transition:opacity .25s ease, transform .25s ease }

    .arming-banner.big .arming-content{

      margin:10px auto; width:min(900px,96vw);

      background:linear-gradient(180deg,#0c131b,#0a1118);

      border:2px solid #2a4a6a; border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,.45);

      padding:10px 12px;

    }

    .arming-banner.big .arming-title{

      font-size:16px; letter-spacing:.4px; color:#d7e8ff;

      text-align:center; margin:2px 0 6px 0;

    }

    .arming-status{

      display:flex; justify-content:center; gap:10px; margin:4px 0 8px; color:#9dc6ff; font-weight:700

    }

    .arming-status .state-dot{ width:10px; height:10px; border-radius:50%; background:#30465d; align-self:center }

    .arming-status[data-state="armed"] .state-dot{ background:#7a661f }

    .arming-status[data-state="reapp"] .state-dot{ background:#2ee6a6 }

    .arming-status[data-state="executing"] .state-dot{ background:#4aa8ff }

    .arming-status[data-state="invalid"] .state-dot{ background:#ff4d4d }

    .arming-row{ display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px }

    .arming-cta{ display:flex; align-items:center; gap:12px }

    .arming-window{

      min-width:72px; text-align:center; font-weight:800; color:#ffe38a;

      border:1px solid #3e5770; padding:6px 10px; border-radius:10px; background:#0f1a24;

    }

    .arming-window[data-mode="off"]{ color:#9fb7d1; opacity:.9 }

    .arming-feed{ flex:1; display:flex; justify-content:flex-end; gap:6px; flex-wrap:nowrap; overflow:hidden }

    .arming-chip{

      min-width:28px; height:28px; border-radius:8px;

      display:flex; align-items:center; justify-content:center;

      font-weight:800; background:#101a24; border:1px solid #2a3c50; color:#b7cbe0;

    }

    .arming-chip.hot{ background:#0f2b1f; border-color:#2ee6a6; color:#bfffe8 }

    .arming-chip.exec{ background:#10202e; border-color:#4aa8ff; color:#cfe7ff }

    .arming-banner.fade-out{ opacity:0; transform:translateY(-6px) }`;

    const style = document.createElement('style');

    style.id = 'dynamicStyles';

    style.textContent = css;

    document.head.appendChild(style);

  })();

  /** ----------------------------- Helpers ------------------------------- */

  const $ = id => document.getElementById(id);

  const nowTs = () => new Date().toLocaleTimeString();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const sleep = ms => new Promise(res => setTimeout(res, ms));

  const fmt2 = n => Number(n).toFixed(2);

  const jitter = (base=120, spread=120) => base + Math.floor(Math.random()*spread);

  const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  const posOr = (v, d) => { const n = numOr(v, d); return n > 0 ? n : d; };

  /** ----------------------------- Logger -------------------------------- */

  const Logger = (() => {

    const area = $('logArea');

    const line = (cls, msg) => {

      const el = document.createElement('div');

      el.className = cls;

      el.textContent = `[${nowTs()}] ${msg}`;

      area.appendChild(el);

      area.scrollTop = area.scrollHeight;

    };

    return {

      ok: msg => line('ok', msg),

      warn: msg => line('warn', msg),

      err: msg => line('err', msg),

      info: msg => line('', msg),

      clear: () => (area.textContent = '')

    };

  })();

  /** ----------------------------- Notifier ------------------------------ */

  const Notifier = (() => {

    const layer = $('notificationLayer');

    const sOverlay = $('summaryOverlay');

    const sTitle = $('summaryTitle');

    const sBody = $('summaryBody');

    const sCount = $('summaryCountdown');

    const armingBanner = $('armingBanner');

    const armingTitle = $('armingTitle');

    const armingDigits = $('armingDigits');

    const armingWindow = $('armingWindow');

    function toast(msg, type='ok', ttlMs=3500){

      const t = document.createElement('div');

      t.className = `toast ${type}`;

      t.textContent = msg;

      layer.appendChild(t);

      setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(6px)'; }, Math.max(500, ttlMs-250));

      setTimeout(()=> { if (t.parentNode) layer.removeChild(t); }, ttlMs);

    }

    async function summary({title, html, seconds=5}){

      sTitle.textContent = title;

      sBody.innerHTML = html;

      sCount.textContent = String(seconds);

      sOverlay.classList.remove('hidden');

      for(let s=seconds; s>0; s--){

        sCount.textContent = String(s);

        await sleep(1000);

      }

      sOverlay.classList.add('hidden');

    }

    function ensureStatus(){

      let band = armingBanner.querySelector('.arming-status');

      if(!band){

        band = document.createElement('div');

        band.className = 'arming-status';

        const dot = document.createElement('div'); dot.className = 'state-dot';

        const label = document.createElement('div'); label.className = 'state-label'; label.textContent = '';

        band.appendChild(dot); band.appendChild(label);

        armingBanner.querySelector('.arming-content').prepend(band);

      }

      return band;

    }

    function setStatus(state){

      const band = ensureStatus();

      band.dataset.state = state;

      const label = band.querySelector('.state-label');

      if(state==='armed') label.textContent = 'Armed — awaiting reappearance';

      if(state==='reapp') label.textContent = 'Reappearance detected — waiting for breakout';

      if(state==='executing') label.textContent = 'Executing…';

      if(state==='invalid') label.textContent = 'Invalidated — returning to analysis';

    }

    function showArming(digit, windowLeft){

      armingTitle.textContent = `Armed with ${digit} — scanning for reappearance`;

      armingWindow.dataset.mode = 'count';

      armingWindow.textContent = String(windowLeft);

      armingDigits.innerHTML = '';

      armingBanner.classList.add('big');

      setStatus('armed');

      armingBanner.classList.remove('hidden','fade-out');

    }

    function updateArming({digit, windowLeft, stream, mode}){

      if(armingBanner.classList.contains('hidden')) return;

      if(mode === 'count'){

        armingWindow.dataset.mode = 'count';

        armingWindow.textContent = String(windowLeft);

      }else{

        armingWindow.dataset.mode = 'off';

        armingWindow.textContent = '—';

      }

      armingTitle.textContent = (mode==='exec')

        ? `Executing on ${digit} — live ticks`

        : `Armed with ${digit} — scanning for reappearance`;

      armingDigits.innerHTML = '';

      stream.slice(-7).forEach(v => {

        const chip = document.createElement('div');

        chip.className = 'arming-chip' + (v===digit ? ' hot':'') + (mode==='exec' ? ' exec':'');

        chip.textContent = (v===0 || v===0?0:v) ?? '—';

        chip.textContent = (v===0 || (typeof v==='number')) ? String(v) : '—';

        armingDigits.appendChild(chip);

      });

    }

    function markReappearance(digit){

      setStatus('reapp');

      toast(`Reappearance detected for ${digit}.`, 'ok', 1200);

    }

    function markExecuting(digit){

      setStatus('executing');

      updateArming({ digit, windowLeft: '—', stream: State.v2.stream, mode: 'exec' });

    }

    function markInvalid(){

      setStatus('invalid');

    }

    function fadeOutArmingQuick(){

      armingBanner.classList.add('fade-out');

      setTimeout(()=> hideArming(), 260);

    }

    function hideArming(){

      armingBanner.classList.add('hidden');

      armingDigits.innerHTML = '';

      armingBanner.classList.remove('fade-out');

      armingWindow.dataset.mode = 'off';

      armingWindow.textContent = '—';

    }

    return { toast, summary, showArming, updateArming, markReappearance, markExecuting, markInvalid, fadeOutArmingQuick, hideArming };

  })();

  /** ----------------------------- UI Renderer --------------------------- */

  const UI = (() => {

    const distBars = new Array(10).fill(null).map(()=>({row:null,bar:null,pct:null}));

    (function initDistribution(){

      const panel = $('distributionPanel');

      panel.innerHTML = '';

      for(let d=0; d<=9; d++){

        const row = document.createElement('div'); row.className='dist-row';

        const lbl = document.createElement('div'); lbl.className='dist-label'; lbl.textContent=String(d);

        const wrap = document.createElement('div'); wrap.className='dist-bar-wrap';

        const bar = document.createElement('div'); bar.className='dist-bar';

        const pct = document.createElement('div'); pct.className='dist-pct'; pct.textContent='0%';

        wrap.appendChild(bar);

        row.appendChild(lbl); row.appendChild(wrap); row.appendChild(pct);

        panel.appendChild(row);

        distBars[d] = { row, bar, pct };

      }

    })();

    function setBadge(id, text){ $(id).textContent = text; }

    function setChip(id, text, extraClass){

      const el = $(id); el.textContent = text;

      el.classList.remove('active','executing','exec');

      if(extraClass) el.classList.add(extraClass);

    }

    function setDigitStrip(digits, identicalX){

      const strip = $('digitStrip');

      strip.innerHTML = '';

      const highlight = (arr => {

        if(arr.length < 2) return false;

        const last = arr[arr.length-1];

        let k=1;

        for(let i=arr.length-2;i>=0 && k<identicalX;i--){

          if(arr[i]===last) k++; else break;

        }

        return k>=identicalX ? {digit:last, len:k} : false;

      })(digits);

      const tail = digits.slice(-7);

      tail.forEach((d, idx) => {

        const box = document.createElement('div');

        box.className='digit-box';

        box.textContent = (d===0 || typeof d==='number') ? String(d) : '—';

        if(highlight && d===highlight.digit && idx >= tail.length - highlight.len){

          box.classList.add('highlight');

        }

        strip.appendChild(box);

      });

    }

    function setDistribution(dist, total){

      for(let d=0; d<=9; d++){

        const c = dist[d] || 0;

        const pct = total>0 ? (c*100/total) : 0;

        distBars[d].bar.style.width = `${pct}%`;

        distBars[d].pct.textContent = `${pct.toFixed(1)}%`;

      }

    }

    function setIgnoreChips(info){

      $('mostFreq').textContent = info.top1 ? `Top1: ${info.top1[0]} (${info.top1[1].toFixed(1)}%)` : 'Top1: —';

      $('secondFreq').textContent = info.top2 ? `Top2: ${info.top2[0]} (${info.top2[1].toFixed(1)}%)` : 'Top2: —';

      $('leastFreq').textContent = info.low1 ? `Low1: ${info.low1[0]} (${info.low1[1].toFixed(1)}%)` : 'Low1: —';

      $('secondLeastFreq').textContent = info.low2 ? `Low2: ${info.low2[0]} (${info.low2[1].toFixed(1)}%)` : 'Low2: —';

    }

    function buildMarketPicker(options){

      const wrap = $('marketPicker');

      wrap.innerHTML = '';

      options.forEach(({value,label,checked})=>{

        const pill = document.createElement('label');

        pill.className='market-pill';

        const cb = document.createElement('input'); cb.type='checkbox'; cb.value=value; cb.checked=checked||false;

        const span = document.createElement('span'); span.textContent = label;

        pill.appendChild(cb); pill.appendChild(span);

        wrap.appendChild(pill);

      });

    }

    function getMarketPickerSelection(){

      return Array.from($('marketPicker').querySelectorAll('input[type=checkbox]'))

        .filter(cb=>cb.checked).map(cb=>cb.value);

    }

    function previewAltSequence(markets){

      $('selectedAltPreview').textContent = markets.length ? `Sequence: ${markets.join(' → ')}` : 'Sequence: —';

    }

    return {

      setBadge, setChip, setDigitStrip, setDistribution, setIgnoreChips,

      buildMarketPicker, getMarketPickerSelection, previewAltSequence

    };

  })();

  /** ----------------------------- State --------------------------------- */

  const State = {

    ws: null,

    authorized: false,

    accountId: null,

    balance: 0,

    sessionPL: 0,

    market: $('marketSelect').value,

    contractType: $('contractType').value,

    tickSubId: null,

    balanceSubId: null,

    historyN: Number($('historyCount').value),

    digitsRolling: [],

    distribution: Array(10).fill(0),

    lastPrice: null,

    // Start gate & execution locks

    startGate: false,

    execMode: 'Analysis',

    execLock: false,

    stopRequested: false,

    // V2 Signal

    v2: {

      armed: false,

      digit: null,

      windowLeft: 6,       // 6-tick non-D window before invalidation

      reappeared: false,   // becomes true only on a NEW tick after arming

      stream: []           // for banner

    },

    // UI status mirrors

    signalState: 'Idle',

    // SBR & Bulk

    sbr: {

      enabled: $('toggleEnabled').checked,

      initial: numOr($('toggleInitial').value, 0.5),

      multiplier: numOr($('toggleMultiplier').value, 2),

      runs: numOr($('toggleRuns').value, 3),

      flawlessNeeded: numOr($('sbrFlawlessPhases').value, 2),

      flawlessCount: 0,

    },

    bulk: { enabled: $('bulkToggle').checked, count: numOr($('bulkCount').value, 2) },

    // Debounce

    debounceTimers: new Map(),

    // Auto-switch sequence

    marketSequence: [],

    // Session

    session: {

      active: false,

      startBalance: 0,

      startTime: null,

      trades: 0,

      wins: 0,

      losses: 0,

      phases: 0,

      sbrRecoveries: 0,

      markets: new Set()

    }

  };

  /** ----------------------------- Deriv WS Service ---------------------- */

  const WS = (() => {

    const ENDPOINT = 'wss://ws.derivws.com/websockets/v3?app_id=97447';

    let ws=null, openP=null, msgId=1;

    const pending = new Map(); // req_id -> {resolve,reject}

    const handlers = new Map(); // msg_type -> Set<fn>

    function connect(){

      if(ws && (ws.readyState===WebSocket.OPEN || ws.readyState===WebSocket.CONNECTING)) return openP;

      ws = new WebSocket(ENDPOINT);

      $('connBadge').textContent = 'CONNECTING...';

      openP = new Promise((resolve,reject)=>{

        ws.onopen = () => { $('connBadge').textContent='CONNECTED'; Logger.ok('Connected to Deriv WS'); resolve(true); };

        ws.onerror = (e) => { Logger.err('WebSocket error'); reject(e); };

        ws.onclose = () => { $('connBadge').textContent='DISCONNECTED'; Logger.warn('WebSocket closed'); Notifier.hideArming(); };

      });

      ws.onmessage = evt => {

        let data;

        try{ data = JSON.parse(evt.data); }catch(e){ Logger.err('Invalid WS JSON'); return; }

        if(data.req_id && pending.has(data.req_id)){

          const p = pending.get(data.req_id);

          if(data.error){ p.reject(data.error); } else { p.resolve(data); }

          pending.delete(data.req_id);

        }

        const type = data.msg_type;

        if(type && handlers.has(type)){

          handlers.get(type).forEach(fn => { try{ fn(data); }catch(_){ } });

        }

      };

      return openP;

    }

    function send(payload){

      if(!ws || ws.readyState!==WebSocket.OPEN) throw new Error('WS not open');

      const req_id = msgId++;

      const msg = Object.assign({ req_id }, payload);

      return new Promise((resolve,reject)=>{

        pending.set(req_id, {resolve, reject});

        ws.send(JSON.stringify(msg));

      });

    }

    function on(type, fn){

      if(!handlers.has(type)) handlers.set(type, new Set());

      handlers.get(type).add(fn);

    }

    function off(type, fn){

      if(!handlers.has(type)) return;

      if(fn) handlers.get(type).delete(fn);

      else handlers.delete(type);

    }

    function isOpen(){ return ws && ws.readyState===WebSocket.OPEN; }

    function close(){ try{ ws && ws.close(); }catch(_){} }

    return { connect, send, on, off, isOpen, close };

  })();

  /** ----------------------------- Decimals Map -------------------------- */

  const DECIMALS = {

    '1HZ10V':2, 'R_10':3, '1HZ15V':3, '1HZ25V':2, 'R_25':3, '1HZ30V':3,

    '1HZ50V':2, 'R_50':4, '1HZ75V':2, 'R_75':4, '1HZ90V':3, '1HZ100V':2, 'R_100':2

  };

  function extractDigitFromQuote(symbol, quote){

    const dec = DECIMALS[symbol] ?? 2;

    const s = String(quote);

    const parts = s.split('.');

    const frac = (parts[1] || '');

    const padded = (frac + '0000000000').slice(0, dec);

    const ch = padded[dec-1] || '0';

    const d = Number(ch);

    return (d>=0 && d<=9) ? d : 0;

  }

  /** ----------------------------- Tick Engine --------------------------- */

  const TickEngine = (() => {

    async function seedHistory(symbol, count){

      if(!WS.isOpen()) throw new Error('WS not open');

      const resp = await WS.send({ ticks_history: symbol, count, end: "latest", style: "ticks" });

      const prices = (resp.history?.prices || []);

      State.digitsRolling = [];

      State.distribution = Array(10).fill(0);

      prices.forEach(p => {

        const d = extractDigitFromQuote(symbol, p);

        State.digitsRolling.push(d);

        State.distribution[d] += 1;

      });

      State.digitsRolling = State.digitsRolling.slice(-State.historyN);

      UI.setDistribution(State.distribution, State.digitsRolling.length);

      UI.setDigitStrip(State.digitsRolling, Number($('identicalCount').value));

      Logger.ok(`Seeded history N=${count} for ${symbol}`);

      refreshIgnoreChips();

    }

    async function subscribeTicks(symbol){

      if(State.tickSubId){

        try{ await WS.send({ forget: State.tickSubId }); Logger.info('Forgot previous tick subscription'); }catch(_){}

        State.tickSubId=null;

      }

      WS.off('tick');

      WS.on('tick', onTick);

      const resp = await WS.send({ ticks: symbol, subscribe: 1 });

      const subId = resp.tick?.id || resp.subscription?.id;

      if(subId){ State.tickSubId = subId; $('marketNow').textContent = `Market: ${symbol}`; }

      else Logger.warn('No subscription id for ticks');

    }

    function onTick(msg){

      if(!msg.tick) return;

      const { symbol, quote } = msg.tick;

      State.lastPrice = quote;

      $('lastPrice').textContent = String(quote);

      const d = extractDigitFromQuote(symbol, quote);

      // Update distributions/rolling

      State.digitsRolling.push(d);

      if(State.digitsRolling.length > State.historyN){

        const rem = State.digitsRolling.shift();

        State.distribution[rem] = Math.max(0, State.distribution[rem]-1);

      }

      State.distribution[d] += 1;

      UI.setDistribution(State.distribution, State.digitsRolling.length);

      UI.setDigitStrip(State.digitsRolling, Number($('identicalCount').value));

      refreshIgnoreChips();

      // Update arming live stream

      State.v2.stream.push(d);

      if (State.v2.stream.length > 32) State.v2.stream.shift();

      // Keep banner live during armed/executing

      if(State.v2.armed || State.execMode==='Executing'){

        const A = State.v2.digit;

        const mode = (State.execMode==='Executing') ? 'exec' : (State.v2.reappeared ? 'off' : 'count');

        const windowLeft = (State.v2.reappeared || State.execMode==='Executing') ? '—' : State.v2.windowLeft;

        Notifier.updateArming({ digit: A, windowLeft, stream: State.v2.stream, mode });

      }

      // Drive V2 logic (no fresh triggers during Executing)

      SignalEngine.onNewDigit(d);

    }

    return { seedHistory, subscribeTicks };

  })();

  /** ----------------------------- Distribution & Ignore ----------------- */

  function computeFrequencyInfo(){

    const total = State.digitsRolling.length || 0;

    const freq = Array.from({length:10}, (_,d) => [d, total? (State.distribution[d]*100/total):0]);

    const sorted = [...freq].sort((a,b)=>b[1]-a[1]);

    const top1 = sorted[0] ?? null;

    const top2 = sorted[1] ?? null;

    const lowSorted = [...freq].sort((a,b)=>a[1]-b[1]);

    const low1 = lowSorted[0] ?? null;

    const low2 = lowSorted[1] ?? null;

    return { top1, top2, low1, low2, freqMap: new Map(freq) };

  }

  function inExtremes(d){

    const info = computeFrequencyInfo();

    const ext = [info.top1?.[0], info.top2?.[0], info.low1?.[0], info.low2?.[0]];

    return { blocked: ext.includes(d), info };

  }

  function refreshIgnoreChips(){

    const info = computeFrequencyInfo();

    UI.setIgnoreChips(info);

    $('prediction').textContent = State.v2.armed ? String(State.v2.digit) : '—';

  }

  /** ----------------------------- UI Locks ------------------------------ */

  function setInputsExecutionLocked(locked){

    const coreStake = $('stakeAmount');

    const coreRuns = $('runsPerSignal');

    const contractType = $('contractType');

    const bulkToggle = $('bulkToggle');

    const bulkCount = $('bulkCount');

    const sbrToggle = $('toggleEnabled');

    [coreStake, coreRuns, contractType, bulkToggle, bulkCount, sbrToggle].forEach(el=>{

      el.disabled = !!locked;

      el.setAttribute('aria-disabled', String(!!locked));

    });

    $('lockNoteB').classList.toggle('hidden', !locked);

    $('lockNoteC').classList.toggle('hidden', !locked);

  }

  function enforceSeparationUI(){

    const sbrOn = $('toggleEnabled').checked;

    const coreStake = $('stakeAmount');

    const coreRuns = $('runsPerSignal');

    const hintStake = $('coreStakeHint');

    const hintRuns = $('coreRunsHint');

    if(sbrOn){

      coreStake.readOnly = true; coreStake.setAttribute('aria-disabled','true'); coreStake.classList.add('readonly');

      coreRuns.readOnly = true; coreRuns.setAttribute('aria-disabled','true'); coreRuns.classList.add('readonly');

      hintStake.textContent = 'SBR is ON: Core stake inactive';

      hintRuns.textContent  = 'SBR is ON: Core runs inactive';

    }else{

      coreStake.readOnly = false; coreStake.removeAttribute('aria-disabled'); coreStake.classList.remove('readonly');

      coreRuns.readOnly = false; coreRuns.removeAttribute('aria-disabled'); coreRuns.classList.remove('readonly');

      hintStake.textContent = '';

      hintRuns.textContent  = '';

    }

  }

  /** ----------------------------- Signal Engine (V2 strict) ------------- */

  const SignalEngine = (() => {

    let tail = []; // identical tail tracker

    function reset(){

      State.v2.armed=false; State.v2.digit=null; State.v2.windowLeft=6; State.v2.reappeared=false;

      UI.setChip('armedStatus','Armed?: No');

      UI.setChip('armedDigit','Armed Digit: —');

      UI.setChip('signalState','Signal State: Idle');

      $('prediction').textContent = '—';

      Notifier.hideArming();

      $('toggleEnabled').disabled = false; // permit flipping when not scanning/executing

      tail = [];

    }

    function tryArm(d){

      const X = clamp(numOr($('identicalCount').value,3),2,10);

      // build/extend identical tail

      if(tail.length===0 || tail[tail.length-1]===d) tail.push(d); else tail=[d];

      if(!State.v2.armed && tail.length>=X){

        const { blocked } = inExtremes(d);

        if(blocked){

          Logger.warn(`Arming blocked: digit [${d}] is among extremes.`);

          return false;

        }

        State.v2.armed = true;

        State.v2.digit = d;

        State.v2.windowLeft = 6;

        State.v2.reappeared = false;

        UI.setChip('armedStatus','Armed?: Yes','active');

        UI.setChip('armedDigit',`Armed Digit: ${d}`);

        UI.setChip('signalState','Signal State: Scanning');

        $('prediction').textContent = String(d);

        $('toggleEnabled').disabled = true; // lock SBR toggle while scanning/executing

        Notifier.toast(`Armed with ${d} — scanning for reappearance.`, 'ok', 1600);

        Notifier.showArming(d, State.v2.windowLeft);

        // CRITICAL: do NOT process the arming tick for reappearance. Caller must RETURN.

        return true;

      }

      return false;

    }

    function onNewDigit(d){

      if(State.execMode==='Executing'){

        // Keep banner stream during execution

        if(State.v2.digit!==null){

          Notifier.updateArming({

            digit: State.v2.digit,

            windowLeft: '—',

            stream: State.v2.stream,

            mode:'exec'

          });

        }

        return;

      }

      // Attempt arming. If just armed on THIS tick, exit immediately (no reappearance on same tick).

      const justArmed = tryArm(d);

      if(justArmed){

        Notifier.updateArming({digit: State.v2.digit, windowLeft: State.v2.windowLeft, stream: State.v2.stream, mode:'count'});

        return;

      }

      if(!State.v2.armed) return;

      const A = State.v2.digit;

      // BEFORE reappearance: decrement only on non-A ticks; invalidate exactly at 6 misses.

      if(!State.v2.reappeared){

        if(d === A){

          State.v2.reappeared = true;

          Notifier.markReappearance(A); // switch status; countdown chip will display "—"

          Logger.ok(`Reappearance observed for digit ${A}. Waiting for breakout…`);

          Notifier.updateArming({digit:A, windowLeft:'—', stream: State.v2.stream, mode:'count'});

          return;

        } else {

          State.v2.windowLeft = Math.max(0, State.v2.windowLeft - 1);

          if(State.v2.windowLeft === 0){

            Logger.warn(`Signal invalidated: digit ${A} did not reappear within 6 ticks.`);

            Notifier.markInvalid();

            Notifier.fadeOutArmingQuick();

            reset();

            return;

          }

          Notifier.updateArming({digit:A, windowLeft: State.v2.windowLeft, stream: State.v2.stream, mode:'count'});

          return;

        }

      }

      // AFTER reappearance: breakout is the first non-A tick

      if(State.v2.reappeared && d !== A){

        const { blocked } = inExtremes(A);

        if(blocked){

          Logger.warn(`Trigger ignored: digit [${A}] is among extremes at trigger.`);

          Notifier.fadeOutArmingQuick();

          reset(); return;

        }

        if(State.startGate && !State.execLock){

          Notifier.markExecuting(A); // keep banner VISIBLE through the whole phase

          ExecutionEngine.executeSignal({ armedDigit: A })

            .finally(()=>{ reset(); }); // banner fade happens inside phase completion (before summary)

        }else{

          Logger.info('Trigger formed but bot not started.');

          Notifier.fadeOutArmingQuick();

          reset();

        }

        return;

      }

      // Still in reappearance streak (d === A): maintain live stream; countdown chip shows "—"

      Notifier.updateArming({digit:A, windowLeft: '—', stream: State.v2.stream, mode:'count'});

    }

    return { onNewDigit, reset };

  })();

  /** ----------------------------- Execution Engine ---------------------- */

  const ExecutionEngine = (() => {

    const pocHandlers = new Map();

    function attachPOC(contract_id, subId, resolve, reject){

      const handler = (msg) => {

        const poc = msg.proposal_open_contract;

        if(!poc || poc.contract_id !== contract_id) return;

        if(poc.is_expired || poc.is_sold){

          const profit = Number(poc.profit) || 0;

          if(subId){ WS.send({ forget: subId }).catch(()=>{}); }

          const set = pocHandlers.get(contract_id);

          if(set){ WS.off('proposal_open_contract', set); pocHandlers.delete(contract_id); }

          resolve(profit);

        }

      };

      pocHandlers.set(contract_id, handler);

      WS.on('proposal_open_contract', handler);

      setTimeout(()=>{

        try{ if(subId) WS.send({ forget: subId }); }catch(_){}

        const set = pocHandlers.get(contract_id);

        if(set){ WS.off('proposal_open_contract', set); pocHandlers.delete(contract_id); }

        reject(new Error('Contract monitor timeout'));

      }, 60_000);

    }

    async function ensureBalanceSub(){

      if(State.balanceSubId) return;

      try{

        const resp = await WS.send({ balance: 1, subscribe: 1 });

        const subId = resp.subscription?.id || resp.balance?.id;

        State.balanceSubId = subId || null;

      }catch(_){ /* ignore */ }

    }

    async function getProposal({amount, contract_type, symbol, barrier}){

      const payload = {

        proposal: 1,

        amount: Number(amount),

        basis: "stake",

        contract_type,

        currency: "USD",

        symbol,

        duration: 1,

        duration_unit: "t",

        barrier: String(barrier)

      };

      const resp = await WS.send(payload);

      if(resp.error){ throw new Error(resp.error.message || 'Proposal error'); }

      return resp.proposal;

    }

    async function buyProposal(pid, price){

      const payload = { buy: pid, price: Number(price) };

      const resp = await WS.send(payload);

      if(resp.error){ throw new Error(resp.error.message || 'Buy error'); }

      return resp.buy;

    }

    async function monitorContract(contract_id){

      const resp = await WS.send({ proposal_open_contract: 1, contract_id, subscribe: 1 });

      const subId = resp.subscription?.id;

      return new Promise((resolve, reject)=> attachPOC(contract_id, subId, resolve, reject));

    }

    function sessionCheckPL(){

      const tp = posOr($('takeProfit').value, 0);

      const sl = posOr($('stopLoss').value, 0);

      if(tp>0 && State.sessionPL >= tp){

        Logger.ok('Take Profit reached. Pausing.');

        State.startGate=false;

        $('execMode').textContent = 'Exec Mode: Analysis';

        return 'TP';

      }

      if(sl>0 && State.sessionPL <= -Math.abs(sl)){

        Logger.warn('Stop Loss reached. Pausing.');

        State.startGate=false;

        $('execMode').textContent = 'Exec Mode: Analysis';

        return 'SL';

      }

      return null;

    }

    async function buyWithRetries(pid, price, retries=3){

      for(let i=0;i<=retries;i++){

        try{ return await buyProposal(pid, price); }

        catch(e){ Logger.warn(`Buy retry (${i+1}) due to: ${e?.message||e}`); await sleep(jitter(100,150)); }

      }

      throw new Error('Buy failed after retries');

    }

    async function runSingle({armedDigit, contractType, amount}){

      const proposal = await getProposal({ amount, contract_type: contractType, symbol: State.market, barrier: armedDigit });

      const pid = proposal.id;

      const bulkN = $('bulkToggle').checked ? clamp(numOr($('bulkCount').value,2), 2, 10) : 1;

      const buys = await Promise.all(new Array(bulkN).fill(0).map(()=> buyWithRetries(pid, amount, 3)));

      const results = await Promise.all(buys.map(b => monitorContract(b.contract_id).then(p => ({p, id:b.contract_id})).catch(()=>({p:0,id:b.contract_id}))));

      const profit = results.reduce((a,c)=> a + Number(c.p||0), 0);

      State.sessionPL += profit;

      $('sessionPL').textContent = `P/L: ${fmt2(State.sessionPL)}`;

      // Per-trade toasts

      results.forEach(r => {

        const sign = r.p>=0 ? '+' : '';

        Notifier.toast((r.p>=0?`WIN: ${sign}$${fmt2(r.p)}`:`LOSS: ${sign}$${fmt2(r.p)}`), r.p>=0?'ok':'err', 3500);

      });

      // Session stats

      State.session.trades += results.length;

      const wins = results.filter(r=>r.p>=0).length;

      const losses = results.length - wins;

      State.session.wins += wins;

      State.session.losses += losses;

      try{ await WS.send({ balance: 1 }); }catch(_){}

      return profit;

    }

    async function standardPhase({armedDigit}){

      const runs = clamp(numOr($('runsPerSignal').value,1),1,100);

      const stake = Math.max(numOr($('stakeAmount').value,0.5), 0.35);

      let total=0;

      for(let i=0;i<runs;i++){

        if(State.stopRequested) break;

        const r = await runSingle({armedDigit, contractType: 'DIGITDIFF', amount: stake});

        total += r;

        const stop = sessionCheckPL(); if(stop) break;

      }

      State.session.phases += 1;

      // Banner persists through all runs; fade RIGHT BEFORE summary

      Notifier.fadeOutArmingQuick();

      await Notifier.summary({

        title: 'Phase Complete (Standard)',

        html: `<div>Runs: ${runs}</div><div>Total: ${fmt2(total)}</div>`,

        seconds: 5

      });

      await sleep(5000);

    }

    async function sbrPhase({armedDigit}){

      const runs = clamp(numOr($('toggleRuns').value,3),1,100);

      const initial = Math.max(numOr($('toggleInitial').value,0.5), 0.35);

      const mult = Math.max(numOr($('toggleMultiplier').value,2), 1.1);

      let total=0, anyLoss=false, usedMultiplier=false;

      for(let i=0;i<runs;i++){

        if(State.stopRequested) break;

        const r = await runSingle({armedDigit, contractType: 'DIGITDIFF', amount: initial});

        total += r;

        if(r<0){

          anyLoss=true; usedMultiplier=true;

          const rec = await runSingle({armedDigit, contractType: 'DIGITDIFF', amount: initial*mult});

          total += rec;

          State.session.sbrRecoveries += 1;

          break;

        }

        const stop = sessionCheckPL(); if(stop) break;

      }

      // flawless counter

      if(!usedMultiplier && !anyLoss){

        State.sbr.flawlessCount += 1;

      }else{

        State.sbr.flawlessCount = 0;

      }

      State.session.phases += 1;

      const needX = clamp(numOr($('sbrFlawlessPhases').value,1),1,100);

      const reasonFlawless = State.sbr.flawlessCount >= needX;

      const seconds = (usedMultiplier || anyLoss || reasonFlawless) ? 10 : 5;

      const autoSwitch = $('autoSwitch').checked && (usedMultiplier || anyLoss || reasonFlawless);

      let switchTo = null;

      let reason = '';

      if(usedMultiplier || anyLoss){ reason = 'Recovery after loss (multiplier applied)'; }

      else if(reasonFlawless){ reason = `Flawless threshold reached (${State.sbr.flawlessCount}/${needX})`; }

      if(autoSwitch){

        switchTo = AutoSwitchManager.pickNextMarket();

      }

      // Fade banner BEFORE summary appears (requirement)

      Notifier.fadeOutArmingQuick();

      await Notifier.summary({

        title: 'Phase Summary (SBR)',

        html: `<div>Runs: ${runs}${usedMultiplier? ' + Recovery':''}</div>

               <div>Any Loss: ${anyLoss? 'Yes':'No'}</div>

               <div>Total: ${fmt2(total)}</div>

               ${autoSwitch? `<div><b>Reason:</b> ${reason}</div>

               <div><b>Switching to:</b> ${switchTo}</div>`:''}`,

        seconds

      });

      if(reasonFlawless){ State.sbr.flawlessCount = 0; }

      if(autoSwitch && switchTo){

        await AutoSwitchManager.switchTo(switchTo);

      }

      await sleep(5000);

    }

    async function executeSignal({armedDigit}){

      if(State.execLock) return;

      State.execLock = true;

      State.execMode = 'Executing';

      UI.setChip('execMode','Exec Mode: Executing','exec');

      UI.setChip('signalState','Signal State: Executing','executing');

      setInputsExecutionLocked(true);

      await ensureBalanceSub();

      try{

        if($('toggleEnabled').checked){

          await sbrPhase({armedDigit});

        }else{

          await standardPhase({armedDigit});

        }

      } catch(e){

        Logger.err(`ExecuteSignal error: ${e?.message||e}`);

      } finally {

        State.execMode = 'Analysis';

        UI.setChip('execMode','Exec Mode: Analysis');

        UI.setChip('signalState','Signal State: Idle');

        State.execLock = false;

        setInputsExecutionLocked(false);

        if(!State.startGate && State.session.active){

          await showSessionSummary();

        }

      }

    }

    async function showSessionSummary(){

      try{

        const bal = await WS.send({ balance: 1 });

        const amt = bal.balance?.balance ?? State.balance;

        State.balance = Number(amt)||0;

        $('balance').textContent = `Balance: ${fmt2(State.balance)}`;

      }catch(_){}

      const endBal = State.balance;

      const startBal = State.session.startBalance;

      const net = endBal - startBal;

      const marketsArr = Array.from(State.session.markets);

      await Notifier.summary({

        title: 'SESSION SUMMARY',

        html: `<div><b>Start:</b> ${fmt2(startBal)} | <b>End:</b> ${fmt2(endBal)} | <b>Net:</b> ${fmt2(net)}</div>

               <div><b>Trades:</b> ${State.session.trades} | <b>Wins:</b> ${State.session.wins} | <b>Losses:</b> ${State.session.losses}</div>

               <div><b>Phases:</b> ${State.session.phases} | <b>SBR Recoveries:</b> ${State.session.sbrRecoveries}</div>

               <div><b>Markets Visited:</b> ${marketsArr.length? marketsArr.join(' → ') : State.market}</div>`,

        seconds: 5

      });

      resetSessionStats();

    }

    return { executeSignal, showSessionSummary };

  })();

  /** ----------------------------- Auto-Switch Manager ------------------- */

  const AutoSwitchManager = (() => {

    const selectEl = $('marketSelect');

    function allOptions(){

      return Array.from(selectEl.options).map(o=>({value:o.value, label:o.textContent}));

    }

    function currentIndexInSeq(){

      const seq = State.marketSequence.length ? State.marketSequence : allOptions().map(o=>o.value);

      const idx = seq.indexOf(State.market);

      return { seq, idx };

    }

    function pickNextMarket(){

      const checked = State.marketSequence.length ? State.marketSequence : allOptions().map(o=>o.value);

      if(!$('randomMarket').checked){

        const { seq, idx } = currentIndexInSeq();

        const next = seq[(idx+1) % seq.length];

        return next;

      }

      const i = Math.floor(Math.random()*checked.length);

      return checked[i];

    }

    async function switchTo(symbol){

      Logger.warn(`Switching market to ${symbol}`);

      if(State.tickSubId){ try{ await WS.send({ forget: State.tickSubId }); }catch(_){ } State.tickSubId=null; }

      State.digitsRolling = [];

      State.distribution = Array(10).fill(0);

      UI.setDistribution(State.distribution, 0);

      UI.setDigitStrip([], Number($('identicalCount').value));

      SignalEngine.reset?.();

      Notifier.hideArming();

      $('marketSelect').value = symbol;

      State.market = symbol;

      $('marketNow').textContent = `Market: ${symbol}`;

      if(State.session.active) State.session.markets.add(symbol);

      State.sbr.flawlessCount = 0; // reset flawless on switch

      await TickEngine.subscribeTicks(symbol);

      await TickEngine.seedHistory(symbol, State.historyN);

    }

    return { pickNextMarket, switchTo };

  })();

  /** ----------------------------- Input & Wiring ------------------------ */

  function debounce(id, fn, ms=400){

    if(State.debounceTimers.has(id)) clearTimeout(State.debounceTimers.get(id));

    const t = setTimeout(()=>{ State.debounceTimers.delete(id); fn(); }, ms);

    State.debounceTimers.set(id, t);

  }

  function resetSessionStats(){

    State.session.active = false;

    State.session.startBalance = 0;

    State.session.startTime = null;

    State.session.trades = 0;

    State.session.wins = 0;

    State.session.losses = 0;

    State.session.phases = 0;

    State.session.sbrRecoveries = 0;

    State.session.markets = new Set([State.market]);

    State.sessionPL = 0;

    $('sessionPL').textContent = `P/L: ${fmt2(State.sessionPL)}`;

  }

  function captureUI(){

    $('connectBtn').addEventListener('click', async ()=>{

      try{

        await WS.connect();

        const token = $('apiToken').value.trim();

        const auth = await WS.send({ authorize: token });

        State.authorized = true;

        State.accountId = auth.authorize?.loginid || '—';

        $('accountId').textContent = State.accountId;

        Logger.ok('Authorized.');

        try{

          const bal = await WS.send({ balance: 1, subscribe: 1 });

          const amt = bal.balance?.balance ?? 0;

          State.balance = Number(amt)||0;

          $('balance').textContent = `Balance: ${fmt2(State.balance)}`;

          State.balanceSubId = bal.subscription?.id || null;

          WS.on('balance', msg=>{

            const b = msg.balance;

            if(typeof b?.balance !== 'undefined'){

              State.balance = Number(b.balance)||0;

              $('balance').textContent = `Balance: ${fmt2(State.balance)}`;

            }

          });

        }catch(_){ Logger.warn('Balance subscription failed'); }

        State.market = $('marketSelect').value;

        await TickEngine.subscribeTicks(State.market);

        await TickEngine.seedHistory(State.market, State.historyN);

        UI.setChip('execMode','Exec Mode: Analysis');

        Logger.ok('Ready for analysis. Click Start to trade.');

      }catch(e){

        Logger.err(`Connect/Auth failed: ${e?.message||e}`);

      }

    });

    $('disconnectBtn').addEventListener('click', async ()=>{

      try{

        if(State.tickSubId){ await WS.send({ forget: State.tickSubId }); State.tickSubId=null; }

        if(State.balanceSubId){ await WS.send({ forget: State.balanceSubId }); State.balanceSubId=null; }

      }catch(_){}

      WS.close();

      State.authorized=false;

      $('connBadge').textContent='DISCONNECTED';

      Logger.warn('Disconnected.');

      Notifier.hideArming();

    });

    $('startBtn').addEventListener('click', ()=>{

      State.startGate = true; State.stopRequested=false;

      State.sessionPL = 0;

      $('sessionPL').textContent = `P/L: ${fmt2(State.sessionPL)}`;

      State.session.active = true;

      State.session.startTime = new Date();

      State.session.startBalance = State.balance;

      State.session.markets = new Set([State.market]);

      State.session.trades = 0; State.session.wins=0; State.session.losses=0; State.session.phases=0; State.session.sbrRecoveries=0;

      Notifier.toast('Bot STARTED', 'ok', 1200);

    });

    $('stopBtn').addEventListener('click', async ()=>{

      State.stopRequested = true; State.startGate=false;

      Notifier.toast('Bot STOP requested (will finish current phase)', 'warn', 1800);

      if(State.execMode!=='Executing'){

        Notifier.hideArming();

      }

      if(!State.execLock && State.session.active){

        await ExecutionEngine.showSessionSummary();

      }

    });

    $('clearLog').addEventListener('click', ()=> Logger.clear());

    $('marketSelect').addEventListener('change', ()=>{

      const symbol = $('marketSelect').value;

      State.market = symbol;

      $('marketNow').textContent = `Market: ${symbol}`;

      debounce('marketChange', async ()=>{

        try{

          if(State.tickSubId){ await WS.send({ forget: State.tickSubId }); State.tickSubId=null; }

          await TickEngine.subscribeTicks(symbol);

          await TickEngine.seedHistory(symbol, State.historyN);

          if(State.session.active) State.session.markets.add(symbol);

          Notifier.hideArming();

        }catch(e){ Logger.err(`Market switch error: ${e?.message||e}`); }

      }, 200);

    });

    $('contractType').addEventListener('change', ()=> {

      State.contractType = $('contractType').value;

      Logger.info(`Contract UI set to ${State.contractType} (execution uses DIGITDIFF on breakout)`);

    });

    // History N: sanitize on change (no mid-typing)

    $('historyCount').addEventListener('change', ()=>{

      const N = clamp(numOr($('historyCount').value,1000),100,5000);

      $('historyCount').value = String(N);

      State.historyN = N;

      if(!State.authorized || !WS.isOpen()) return;

      TickEngine.seedHistory(State.market, N).catch(e=>Logger.err(`History reseed failed: ${e?.message||e}`));

    });

    // Bulk

    $('bulkToggle').addEventListener('change', ()=>{

      State.bulk.enabled = $('bulkToggle').checked;

      if(State.bulk.enabled && $('toggleEnabled').checked){

        Notifier.toast('SBR governs stake/runs; Bulk only adds parallel buys.', 'warn', 2600);

      }

    });

    $('bulkCount').addEventListener('change', ()=>{

      const v = clamp(numOr($('bulkCount').value,2),2,10);

      $('bulkCount').value = String(v);

      State.bulk.count = v;

    });

    // SBR toggle & fields — sanitize on change only

    $('toggleEnabled').addEventListener('change', ()=>{

      State.sbr.enabled = $('toggleEnabled').checked;

      enforceSeparationUI();

      if(State.sbr.enabled){

        Notifier.toast('SBR ON: Core stake/runs are inactive. Bulk still applies.', 'warn', 2600);

      }

    });

    $('toggleInitial').addEventListener('change', ()=>{

      const val = Math.max(numOr($('toggleInitial').value,0.5), 0.35);

      $('toggleInitial').value = String(val.toFixed(2));

      State.sbr.initial = val;

    });

    $('toggleMultiplier').addEventListener('change', ()=>{

      const val = Math.max(numOr($('toggleMultiplier').value,2), 1.1);

      $('toggleMultiplier').value = String(val);

      State.sbr.multiplier = val;

    });

    $('toggleRuns').addEventListener('change', ()=>{

      const val = clamp(numOr($('toggleRuns').value,3),1,100);

      $('toggleRuns').value = String(val);

      State.sbr.runs = val;

    });

    $('sbrFlawlessPhases').addEventListener('change', ()=>{

      const val = clamp(numOr($('sbrFlawlessPhases').value,2),1,100);

      $('sbrFlawlessPhases').value = String(val);

      State.sbr.flawlessNeeded = val;

    });

    // Market sequence UI

    const marketOptions = Array.from($('marketSelect').options).map(o=>({value:o.value, label:o.textContent}));

    UI.buildMarketPicker(marketOptions);

    UI.previewAltSequence(State.marketSequence);

    $('toggleMarketPicker').addEventListener('click', ()=>{

      $('marketPicker').classList.toggle('hidden');

      adjustHeaderOffset();

    });

    $('marketPicker').addEventListener('change', ()=>{

      State.marketSequence = UI.getMarketPickerSelection();

      UI.previewAltSequence(State.marketSequence);

    });

    $('clearMarketAlt').addEventListener('click', ()=>{

      State.marketSequence = [];

      UI.buildMarketPicker(marketOptions.map(o=>({ ...o, checked:false })));

      UI.previewAltSequence(State.marketSequence);

    });

  }

  /** ----------------------------- Boot ---------------------------------- */

  function boot(){

    captureUI();

    UI.setBadge('connBadge','DISCONNECTED');

    UI.setBadge('accountId','—');

    UI.setBadge('balance','Balance: —');

    UI.setBadge('sessionPL','P/L: 0.00');

    UI.setBadge('marketNow',`Market: ${State.market}`);

    UI.setChip('armedStatus','Armed?: No');

    UI.setChip('armedDigit','Armed Digit: —');

    UI.setChip('signalState','Signal State: Idle');

    UI.setChip('execMode','Exec Mode: Analysis');

    enforceSeparationUI();

    resetSessionStats();

    adjustHeaderOffset();

  }

  boot();

})();