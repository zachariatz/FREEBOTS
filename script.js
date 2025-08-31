/* =========================================================================
   MD+ RISKTAKER PRO BOT — Fast reliable sequential buys with micro-delay
   - Full replacement JS
   - For each of X trades: proposal -> buy (await responses) -> immediate next
   - Minimal micro-delay between buys (default 8ms) to avoid race conditions
   - Settlements handled asynchronously via proposal_open_contract
   - Blind-phase & market-shift logic preserved
   ========================================================================= */

(() => {
  "use strict";

  // --- Internal WS (kept out of UI) ---
  const WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=97447";

  // --- Markets & decimal mapping ---
  const MARKETS = [
    { sym: "1HZ10V",  name: "VOLATILITY 10 (1S) INDEX",  decimals: 2 },
    { sym: "R_10",    name: "VOLATILITY 10 INDEX",       decimals: 3 },
    { sym: "1HZ15V",  name: "VOLATILITY 15 (1S) INDEX",  decimals: 3 },
    { sym: "1HZ25V",  name: "VOLATILITY 25 (1S) INDEX",  decimals: 2 },
    { sym: "R_25",    name: "VOLATILITY 25 INDEX",       decimals: 3 },
    { sym: "1HZ30V",  name: "VOLATILITY 30 (1S) INDEX",  decimals: 3 },
    { sym: "1HZ50V",  name: "VOLATILITY 50 (1S) INDEX",  decimals: 2 },
    { sym: "R_50",    name: "VOLATILITY 50 INDEX",       decimals: 4 },
    { sym: "1HZ75V",  name: "VOLATILITY 75 (1S) INDEX",  decimals: 2 },
    { sym: "R_75",    name: "VOLATILITY 75 INDEX",       decimals: 4 },
    { sym: "1HZ90V",  name: "VOLATILITY 90 (1S) INDEX",  decimals: 3 },
    { sym: "1HZ100V", name: "VOLATILITY 100 (1S) INDEX", decimals: 2 },
    { sym: "R_100",   name: "VOLATILITY 100 INDEX",      decimals: 2 }
  ];
  const findMarketMeta = (sym) => MARKETS.find(m => m.sym === sym) || { sym, name: sym, decimals: 2 };

  // --- DOM helpers & elements (assumes HTML has these IDs) ---
  const $ = sel => document.querySelector(sel);
  const logEl = $("#log");
  const last7El = $("#last7");
  const distGrid = $("#distGrid");
  const nWindowEl = $("#nWindow");
  const pnlVal = $("#pnlVal");
  const pnlCcy = $("#pnlCcy");
  const cycleInfo = $("#cycleInfo");
  const connDot = $("#connDot");
  const connText = $("#connText");
  const balanceVal = $("#balanceVal");
  const balanceCcy = $("#balanceCcy");
  const marketName = $("#marketName");
  const toastHost = $("#toastHost");
  const armedOverlay = $("#armedOverlay");
  const armedDigitEl = $("#armedDigit");
  const shiftOverlay = $("#shiftOverlay");
  const shiftCountdown = $("#shiftCountdown");
  const sumMarket = $("#sumMarket");
  const sumTimeframe = $("#sumTimeframe");
  const sumSignals = $("#sumSignals");
  const sumTrades = $("#sumTrades");
  const sumWL = $("#sumWL");
  const sumPL = $("#sumPL");
  const sumAvgStake = $("#sumAvgStake");
  const sumIgnored = $("#sumIgnored");
  const sumNext = $("#sumNext");
  const shiftTitle = $("#shiftTitle");

  const nowTs = () => new Date().toLocaleTimeString([], { hour12: false });

  function uiLog(msg, ctx = "") {
    try {
      const line = document.createElement("div");
      line.className = "log-line";
      line.innerHTML = `<span class="log-ts">[${nowTs()}]</span> <span class="log-ctx">${ctx}</span> ${msg}`;
      if (logEl) logEl.prepend(line);
    } catch (e) { /* ignore UI errors */ }
  }

  function setStatus(state, text) {
    if (!connDot || !connText) return;
    connDot.classList.remove("ok", "warn", "err");
    if (state === "ok") connDot.classList.add("ok");
    else if (state === "warn") connDot.classList.add("warn");
    else if (state === "err") connDot.classList.add("err");
    connText.textContent = text;
  }

  function toast({ title = "", msg = "", ok = true, long = false, short = false }) {
    try {
      if (!toastHost) return;
      const t = document.createElement("div");
      t.className = `toast ${ok ? "ok" : "err"}`;
      t.innerHTML = `<div class="t">${title}</div><div class="m">${msg}</div>`;
      toastHost.appendChild(t);
      setTimeout(() => {
        t.style.opacity = "0";
        setTimeout(() => t.remove(), 220);
      }, long ? 3500 : (short ? 600 : 1600));
    } catch (e) { /* ignore */ }
  }

  function showArmedOverlay(digit) {
    try {
      if (!armedOverlay) return;
      armedDigitEl.textContent = String(digit);
      armedOverlay.classList.remove("hidden");
    } catch (e) { /* ignore */ }
  }
  function hideArmedOverlay() {
    try { if (!armedOverlay) return; armedOverlay.classList.add("hidden"); } catch (e) { /* ignore */ }
  }

  async function showShiftOverlay(summary, seconds = 10) {
    try {
      if (!shiftOverlay) return;
      sumMarket.textContent = summary.market;
      sumTimeframe.textContent = summary.timeframe;
      sumSignals.textContent = summary.signals;
      sumTrades.textContent = summary.trades;
      sumWL.textContent = `${summary.wins} / ${summary.losses}`;
      sumPL.textContent = `${summary.net_pl.toFixed(2)} ${summary.ccy || ""}`;
      sumAvgStake.textContent = summary.avg_stake ? `${summary.avg_stake.toFixed(2)} ${summary.ccy || ""}` : "—";
      sumIgnored.textContent = summary.ignored;
      sumNext.textContent = summary.nextMarket || "—";
      shiftTitle.textContent = `Market Summary — ${summary.market}`;

      shiftOverlay.classList.remove("hidden");
      for (let s = seconds; s >= 1; s--) {
        shiftCountdown.textContent = String(s);
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 1000));
      }
      shiftOverlay.classList.add("hidden");
      toast({ title: "Shifting market", msg: `Now shifting to volatility: ${summary.nextMarket}`, ok: true });
    } catch (e) { /* ignore */ }
  }

  function renderLast7(arr) {
    try {
      if (!last7El) return;
      last7El.innerHTML = "";
      const slice = arr.slice(-7);
      if (slice.length === 0) { last7El.innerHTML = `<div class="digit-chip">—</div>`; return; }
      slice.forEach(d => {
        const chip = document.createElement("div");
        chip.className = "digit-chip pop";
        chip.textContent = String(d);
        last7El.appendChild(chip);
      });
    } catch (e) { /* ignore */ }
  }

  function renderDistribution(counts, total) {
    try {
      if (!distGrid) return;
      distGrid.innerHTML = "";
      for (let d = 0; d <= 9; d++) {
        const cnt = counts[d] || 0;
        const pct = total > 0 ? (cnt / total) * 100 : 0;
        const cell = document.createElement("div");
        cell.className = "dist-cell";
        cell.innerHTML = `
          <div class="d">${d}</div>
          <div class="bar"><span style="width:${pct.toFixed(2)}%"></span></div>
          <div class="pct">${pct.toFixed(2)}%</div>
          <div class="cnt">${cnt}</div>
        `;
        distGrid.appendChild(cell);
      }
    } catch (e) { /* ignore */ }
  }

  // --- Digit extraction according to decimals mapping ---
  function extractDigit(quoteStr, symbol) {
    const meta = findMarketMeta(symbol);
    const d = meta.decimals || 2;
    const s = String(quoteStr);
    const dot = s.indexOf(".");
    let decimals = dot >= 0 ? s.slice(dot + 1) : "";
    if (decimals.length < d) decimals = decimals.padEnd(d, "0");
    const ch = decimals.charAt(d - 1) || "0";
    return parseInt(ch, 10);
  }

  // --- Deriv minimal WebSocket wrapper ---
  class DerivWS {
    constructor() {
      this.ws = null;
      this.req = 1;
      this.pending = new Map();
      this.listeners = {};
      this.connected = false;
    }

    connect() {
      return new Promise((resolve, reject) => {
        try { this.ws = new WebSocket(WS_URL); } catch (err) { reject(err); return; }
        this.ws.onopen = () => { this.connected = true; resolve(); };
        this.ws.onmessage = (ev) => this._onMessage(ev);
        this.ws.onerror = (e) => { this.connected = false; reject(e); };
        this.ws.onclose = () => {
          this.connected = false;
          setStatus("err", "Disconnected");
          uiLog("WebSocket closed.", "WS");
        };
      });
    }

    _onMessage(ev) {
      let data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      if (typeof data.req_id !== "undefined" && this.pending.has(data.req_id)) {
        const p = this.pending.get(data.req_id);
        this.pending.delete(data.req_id);
        if (data.error) p.reject(data); else p.resolve(data);
      }
      if (data.msg_type) {
        const set = this.listeners[data.msg_type];
        if (set) for (const fn of set) { try { fn(data); } catch (_) { } }
      }
      if (this.listeners["message"]) for (const fn of this.listeners["message"]) try { fn(data); } catch (_) { }
      if (data.error) uiLog(`<b>API Error:</b> ${data.error.code} — ${data.error.message}`, "API");
    }

    on(msg_type, fn) {
      this.listeners[msg_type] ??= new Set();
      this.listeners[msg_type].add(fn);
      return () => this.listeners[msg_type].delete(fn);
    }

    send(payload) {
      if (!this.connected) return Promise.reject(new Error("WS not connected"));
      const req_id = this.req++;
      const withId = Object.assign({ req_id }, payload);
      try { this.ws.send(JSON.stringify(withId)); } catch (e) { return Promise.reject(e); }
      const p = new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          if (this.pending.has(req_id)) { this.pending.delete(req_id); reject(new Error("Request timeout")); }
        }, 12000);
        this.pending.set(req_id, {
          resolve: (d) => { clearTimeout(t); resolve(d); },
          reject: (d) => { clearTimeout(t); reject(d); }
        });
      });
      return p;
    }

    close() { try { this.ws?.close(); } catch (_) { } this.connected = false; }
  }

  // --- Per-market state ---
  class MarketState {
    constructor(symbol) {
      this.symbol = symbol;
      this.name = findMarketMeta(symbol).name;
      this.n = 1000;
      this.queue = [];
      this.counts = Array(10).fill(0);
      this.last7 = [];
      this.first_ts = null;
      this.last_ts = null;
      this.prevDigit = null;
      this.runDigit = null;
      this.runLen = 0;
      this.signals = 0;
      this.trades = 0;
      this.wins = 0;
      this.losses = 0;
      this.ignored = 0;
      this.stakes = [];
    }

    clearData() {
      this.queue.length = 0;
      this.counts = Array(10).fill(0);
      this.last7.length = 0;
      this.prevDigit = this.runDigit = null;
      this.runLen = 0;
      this.first_ts = this.last_ts = null;
      this.signals = this.trades = this.wins = this.losses = this.ignored = 0;
      this.stakes = [];
    }

    pushTick(quote, epoch) {
      const d = extractDigit(quote, this.symbol);
      this.queue.push(d);
      this.counts[d] += 1;
      if (this.queue.length > this.n) {
        const rm = this.queue.shift();
        this.counts[rm] -= 1;
      }
      this.last7.push(d);
      if (this.last7.length > 7) this.last7.shift();
      if (!this.first_ts) this.first_ts = epoch || Math.floor(Date.now() / 1000);
      this.last_ts = epoch || Math.floor(Date.now() / 1000);

      if (this.prevDigit === null) {
        this.prevDigit = d;
        this.runDigit = d;
        this.runLen = 1;
        return null;
      } else {
        if (d === this.prevDigit) {
          this.runLen += 1;
          return null;
        } else {
          const breakout = d;
          const changed = { breakout, runDigit: this.prevDigit, runLen: this.runLen };
          this.prevDigit = d;
          this.runDigit = d;
          this.runLen = 1;
          return changed;
        }
      }
    }

    distributionRanks() {
      const arr = [];
      for (let i = 0; i <= 9; i++) arr.push({ d: i, c: this.counts[i] });
      const desc = [...arr].sort((a, b) => b.c - a.c || a.d - b.d);
      const asc = [...arr].sort((a, b) => a.c - b.c || a.d - b.d);
      return { desc, asc };
    }

    timeframeStr() {
      if (!this.first_ts || !this.last_ts) return "—";
      const a = new Date(this.first_ts * 1000);
      const b = new Date(this.last_ts * 1000);
      const fmt = (t) => `${t.toLocaleDateString()} ${t.toLocaleTimeString([], { hour12: false })}`;
      return `${fmt(a)} → ${fmt(b)}`;
    }
  }

  // --- Main bot ---
  class RiskTakerBot {
    constructor() {
      // UI
      this.$token = $("#apiToken");
      this.$connect = $("#btnConnect");
      this.$start = $("#btnStart");
      this.$stop = $("#btnStop");
      this.$stakePct = $("#stakePct");
      this.$lowTh = $("#lowBalanceThreshold");
      this.$minRun = $("#minRun");
      this.$tps = $("#tradesPerSignal");
      this.$nwin = $("#distN");
      this.$rotMode = $("#rotationMode");
      this.$marketSelect = $("#marketSelect");

      // internals
      this.deriv = new DerivWS();
      this.token = null;
      this.currency = "";
      this.balance = 0;
      this.pnl = 0;

      // market
      this.currentSymbol = this.$marketSelect?.value || MARKETS[0].sym;
      this.marketState = new MarketState(this.currentSymbol);
      this.marketState.n = parseInt(this.$nwin?.value || "1000", 10);

      // subs
      this.tickSubId = null;
      this.balanceSubId = null;
      this._tickUnsub = null;
      this._balanceUnsub = null;

      // flags
      this.tradingEnabled = false;
      this.analyzing = true;
      this.armedDigit = null;
      this.cycleInProgress = false;
      this.isTrading = false;        // while placing proposal+buys
      this.isShiftingMarket = false; // while overlay+subscribe
      this.tradesExecutedThisMarket = 0;

      // contract tracking
      this.contractMap = new Map(); // contract_id -> { stake, symbol, barrier, bought_at, symbolState }

      // rotation
      this.rotationMode = this.$rotMode?.value || "series";
      this.seriesIdx = MARKETS.findIndex(m => m.sym === this.currentSymbol);
      if (this.seriesIdx < 0) this.seriesIdx = 0;

      // risk gates
      this.takeProfit = parseFloat($("#takeProfit")?.value || "999999");
      this.stopLoss = parseFloat($("#stopLoss")?.value || "999999");

      // micro-delay between trades in milliseconds (tiny)
      this.microDelayMs = 8;

      // bind UI and listeners
      this.bindUI();
      this.setupPocListener();
      this.renderAll();
      uiLog("Bot initialized. Connect, then start when ready.", "APP");
    }

    bindUI() {
      if (this.$connect) this.$connect.addEventListener("click", () => this.connect());
      if (this.$start) this.$start.addEventListener("click", () => this.toggleStart(true));
      if (this.$stop) this.$stop.addEventListener("click", () => this.toggleStart(false));
      if (this.$marketSelect) this.$marketSelect.addEventListener("change", () => this.changeMarket(this.$marketSelect.value));
      if (this.$nwin) this.$nwin.addEventListener("change", () => {
        this.marketState.n = Math.max(25, Math.min(25000, parseInt(this.$nwin.value, 10) || 1000));
        if (nWindowEl) nWindowEl.textContent = String(this.marketState.n);
        uiLog(`Distribution window set to N=${this.marketState.n}`, "CFG");
      });
      if (this.$rotMode) this.$rotMode.addEventListener("change", () => {
        this.rotationMode = this.$rotMode.value;
        uiLog(`Rotation mode: ${this.rotationMode.toUpperCase()}`, "CFG");
      });
      const tp = $("#takeProfit");
      const sl = $("#stopLoss");
      if (tp) tp.addEventListener("change", e => this.takeProfit = Math.max(0, parseFloat(e.target.value || "0")));
      if (sl) sl.addEventListener("change", e => this.stopLoss = Math.max(0, parseFloat(e.target.value || "0")));
    }

    setupPocListener() {
      // handle asynchronous settlement updates
      this.deriv.on("proposal_open_contract", (data) => {
        const poc = data?.proposal_open_contract;
        if (!poc) return;
        const cid = poc.contract_id;
        if (!cid) return;
        if (!this.contractMap.has(cid)) return; // unknown contract
        if (poc.is_sold) {
          const entry = this.contractMap.get(cid);
          const payout = typeof poc.payout === "number" ? poc.payout : parseFloat(poc.payout || "0");
          const profit = typeof poc.profit === "number" ? poc.profit : parseFloat(poc.profit || "0");
          if (profit > 0) entry.symbolState.wins += 1; else entry.symbolState.losses += 1;
          this.pnl += profit;
          if (pnlVal) pnlVal.textContent = this.pnl.toFixed(2);
          const title = profit > 0 ? `WIN +${profit.toFixed(2)} ${this.currency}` : `LOSS ${profit.toFixed(2)} ${this.currency}`;
          toast({ title, msg: `${entry.symbol} • barrier ${entry.barrier}`, ok: profit > 0, short: true });
          uiLog(`${profit > 0 ? "WIN" : "LOSS"} ${profit.toFixed(2)} • contract ${cid} • stake ${entry.stake.toFixed(2)}`, "SETTLE");
          this.contractMap.delete(cid);
        }
      });
    }

    async connect() {
      try {
        setStatus("warn", "Connecting…");
        await this.deriv.connect();
        setStatus("ok", "Connected");
        uiLog("WebSocket connected.", "WS");
      } catch (e) {
        setStatus("err", "Connection failed");
        uiLog("Failed to connect to WebSocket.", "WS");
        toast({ title: "Connection failed", msg: String(e?.message || e), ok: false });
        return;
      }

      const tok = (this.$token?.value || "").trim();
      if (!tok) { toast({ title: "Token required", msg: "Please enter your Deriv API token.", ok: false }); return; }
      this.token = tok;
      try {
        const authResp = await this.deriv.send({ authorize: this.token });
        if (authResp.error) throw authResp;
        setStatus("ok", "Authorized");
        uiLog("Authorized with token.", "AUTH");
        this.currency = authResp?.authorize?.currency || this.currency || "";
        if (pnlCcy) pnlCcy.textContent = this.currency ? ` ${this.currency}` : "";
        await this.subscribeBalance();
        await this.subscribeMarket(this.currentSymbol, { initial: true });
        toast({ title: "Ready", msg: "Streams active. Click Start to enable trading." });
      } catch (e) {
        setStatus("err", "Auth failed");
        toast({ title: "Auth failed", msg: String(e?.error?.message || e?.message || "Invalid token"), ok: false, long: true });
        uiLog("Authorization failed.", "AUTH");
      }
    }

    async subscribeBalance() {
      if (this._balanceUnsub) { try { this._balanceUnsub(); } catch (_) { } this._balanceUnsub = null; }
      this._balanceUnsub = this.deriv.on("balance", (d) => {
        const b = d?.balance;
        if (!b) return;
        const bal = typeof b.balance === "number" ? b.balance : parseFloat(b.balance || "0");
        this.balance = bal;
        if (balanceVal) balanceVal.textContent = bal.toFixed(2);
        if (b.currency) {
          this.currency = b.currency;
          if (balanceCcy) balanceCcy.textContent = this.currency;
          if (pnlCcy) pnlCcy.textContent = this.currency ? ` ${this.currency}` : "";
        }
      });
      try {
        const res = await this.deriv.send({ balance: 1, subscribe: 1 });
        this.balanceSubId = res?.subscription?.id || null;
        uiLog("Subscribed to account balance.", "BAL");
      } catch (e) { uiLog("Balance subscription failed.", "BAL"); }
    }

    async subscribeMarket(symbol, { initial = false } = {}) {
      // remove tick listener if present
      if (this._tickUnsub) { try { this._tickUnsub(); } catch (_) { } this._tickUnsub = null; }
      try { await this.forgetAll("ticks"); } catch (_) { }
      this.tickSubId = null;

      this.currentSymbol = symbol;
      this.marketState = new MarketState(symbol);
      this.marketState.n = Math.max(25, Math.min(25000, parseInt(this.$nwin?.value || "1000", 10) || 1000));
      if (nWindowEl) nWindowEl.textContent = String(this.marketState.n);
      if (marketName) marketName.textContent = `${findMarketMeta(symbol).sym} – ${findMarketMeta(symbol).name}`;

      // history
      const N = this.marketState.n;
      try {
        const hist = await this.deriv.send({
          ticks_history: symbol,
          count: N,
          end: "latest",
          style: "ticks",
          adjust_start_time: 1
        });
        const prices = hist?.history?.prices || [];
        const times = hist?.history?.times || [];
        for (let i = 0; i < prices.length; i++) {
          const q = prices[i];
          const epoch = times[i] ? parseInt(times[i], 10) : Math.floor(Date.now() / 1000);
          this.marketState.pushTick(q, epoch);
        }
        this.renderAll();
        uiLog(`Loaded ${prices.length} historical ticks for ${symbol}.`, "HIST");
      } catch (e) { uiLog(`Failed to load history for ${symbol}.`, "HIST"); }

      // tick handler
      this._tickUnsub = this.deriv.on("tick", (data) => {
        const t = data?.tick;
        if (!t || t.symbol !== symbol) return;
        const change = this.marketState.pushTick(t.quote, t.epoch || Math.floor(Date.now() / 1000));
        this.renderAll();
        if (change && this.analyzing) this.handlePossibleBreakout(change);
      });

      try {
        const live = await this.deriv.send({ ticks: symbol, subscribe: 1 });
        this.tickSubId = live?.subscription?.id || null;
        uiLog(`Subscribed to live ticks for ${symbol}.`, "TICKS");
      } catch (e) { uiLog(`Failed to subscribe live ticks for ${symbol}.`, "TICKS"); }

      if (!initial) toast({ title: "Market subscribed", msg: `Streaming ${symbol}.`, ok: true });
    }

    handlePossibleBreakout(change) {
      try {
        // blind-phase short-circuit
        if (this.isTrading) { uiLog(`Signal ignored (blind-phase: trading) — breakout ${change.breakout}`, this.currentSymbol); return; }
        if (this.isShiftingMarket) { uiLog(`Signal ignored (blind-phase: shifting) — breakout ${change.breakout}`, this.currentSymbol); return; }
        if (this.cycleInProgress) { uiLog(`Signal ignored (cycle in progress) — breakout ${change.breakout}`, this.currentSymbol); return; }

        const minRun = Math.max(1, parseInt(this.$minRun?.value || "2", 10) || 2);
        if (change.runLen >= minRun) {
          const breakout = change.breakout;
          const { desc, asc } = this.marketState.distributionRanks();
          const top3 = desc.slice(0, 3).map(x => x.d);
          const bottom2 = asc.slice(0, 2).map(x => x.d);
          const excluded = new Set([...top3, ...bottom2]);
          if (excluded.has(breakout)) {
            this.marketState.ignored += 1;
            uiLog(`Ignored breakout ${breakout} due to exclusion (top3/bottom2).`, this.currentSymbol);
          } else {
            this.marketState.signals += 1;
            this.armedDigit = breakout;
            showArmedOverlay(breakout);
            uiLog(`ARMED signal — breakout digit ${breakout}`, this.currentSymbol);
            if (this.tradingEnabled && !this.isTrading && !this.isShiftingMarket && !this.cycleInProgress) {
              // start very fast sequential buys: ensures all X trades are purchased
              this.startFastSequentialCycle(breakout).catch(e => uiLog(`Fast seq cycle error: ${String(e?.message || e)}`, "CYCLE"));
            }
          }
        }
      } catch (e) { uiLog(`Error in handlePossibleBreakout: ${String(e?.message || e)}`, "ANALYSIS"); }
    }

    // Fast sequential pipeline: proposal -> buy for each trade, micro-delay between trades
    async startFastSequentialCycle(armedDigit) {
      if (this.isTrading || this.isShiftingMarket || this.cycleInProgress) {
        uiLog("Start request ignored due to blind-phase or ongoing cycle.", this.currentSymbol);
        return;
      }

      this.cycleInProgress = true;
      this.analyzing = false;
      this.isTrading = true; // ignore incoming signals while placing buys
      cycleInfo.textContent = `Armed ${armedDigit} • executing ${this.$tps?.value || 1} trades...`;

      const tradesPerSignal = Math.max(1, parseInt(this.$tps?.value || "1", 10) || 1);
      let purchasesCompleted = 0;

      // compute consistent batch stake to avoid per-loop balance recomputation slowdown
      const pct = Math.max(1, Math.min(100, parseFloat(this.$stakePct?.value || "50")));
      const threshold = Math.max(0, parseFloat(this.$lowTh?.value || "0.35"));
      let stake = (this.balance || 0) * (pct / 100);
      if (stake < threshold) stake = this.balance;
      stake = Math.max(threshold, Math.floor((stake + 1e-9) * 100) / 100);

      if (stake <= 0) {
        uiLog("Insufficient balance for batch trades - aborting cycle.", "TRADE");
        this.isTrading = false;
        this.analyzing = true;
        this.cycleInProgress = false;
        hideArmedOverlay();
        return;
      }

      // helper with small retry attempts for proposal
      const getProposalId = async (attempt = 0) => {
        try {
          const resp = await this.deriv.send({
            proposal: 1,
            amount: Number(stake.toFixed(2)),
            basis: "stake",
            contract_type: "DIGITDIFF",
            currency: this.currency || "USD",
            duration: 1,
            duration_unit: "t",
            symbol: this.currentSymbol,
            barrier: String(armedDigit)
          });
          return resp?.proposal?.id || null;
        } catch (e) {
          if (attempt < 2) {
            // tiny backoff
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, 10));
            return getProposalId(attempt + 1);
          }
          return null;
        }
      };

      // helper buy (small retries)
      const doBuy = async (proposalId, attempt = 0) => {
        try {
          const resp = await this.deriv.send({ buy: proposalId, price: Number(stake.toFixed(2)) });
          return resp;
        } catch (e) {
          if (attempt < 2) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, 10));
            return doBuy(proposalId, attempt + 1);
          }
          return null;
        }
      };

      try {
        for (let i = 1; i <= tradesPerSignal; i++) {
          if (!this.tradingEnabled) break;

          // check TP/SL quickly (pre-buy)
          if (this.takeProfit && this.pnl >= this.takeProfit) {
            uiLog("Take Profit reached — stopping buys.", "RISK");
            toast({ title: "TP reached", msg: `P/L ${this.pnl.toFixed(2)} ${this.currency}`, ok: true, long: true });
            this.tradingEnabled = false;
            break;
          }
          if (this.stopLoss && -this.pnl >= this.stopLoss) {
            uiLog("Stop Loss reached — stopping buys.", "RISK");
            toast({ title: "SL reached", msg: `P/L ${this.pnl.toFixed(2)} ${this.currency}`, ok: false, long: true });
            this.tradingEnabled = false;
            break;
          }

          // 1) get proposal id (fast)
          const proposalId = await getProposalId();
          if (!proposalId) {
            uiLog(`Proposal failed for trade ${i}; continuing to next quickly.`, "TRADE");
            // tiny micro-delay before continuing to next iteration
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, this.microDelayMs));
            continue;
          }

          // 2) buy immediately
          const buyResp = await doBuy(proposalId);
          if (!buyResp || !buyResp.buy || !buyResp.buy.contract_id) {
            uiLog(`Buy failed for trade ${i}; proposal_id ${proposalId}`, "BUY");
            // micro-delay and continue
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, this.microDelayMs));
            continue;
          }

          const contract_id = buyResp.buy.contract_id;
          // track contract for later settlement handling
          this.contractMap.set(contract_id, {
            stake,
            symbol: this.currentSymbol,
            barrier: armedDigit,
            bought_at: Date.now(),
            symbolState: this.marketState
          });

          // immediate UI updates
          purchasesCompleted++;
          this.marketState.trades += 1;
          this.marketState.stakes.push(stake);
          this.tradesExecutedThisMarket += 1;
          // quick buy toast
          toast({ title: `Bought (${purchasesCompleted}/${tradesPerSignal})`, msg: `${this.currentSymbol} • barrier ${armedDigit} • stake ${stake.toFixed(2)}`, ok: true, short: true });
          uiLog(`Buy placed ${purchasesCompleted}/${tradesPerSignal} • contract ${contract_id} • stake ${stake.toFixed(2)}`, "BUY");

          // micro-delay to let network breathe (very small)
          // eslint-disable-next-line no-await-in-loop
          await new Promise(r => setTimeout(r, this.microDelayMs));
        }
      } catch (e) {
        uiLog(`Exception in fast sequential cycle: ${String(e?.message || e)}`, "CYCLE");
      } finally {
        // end buying phase
        this.isTrading = false;
        this.analyzing = true;
        this.cycleInProgress = false;
        hideArmedOverlay();
        cycleInfo.textContent = "—";
      }

      const completedFullCycle = (purchasesCompleted === tradesPerSignal);

      if (completedFullCycle) {
        // begin safe shift (blind-phase)
        try {
          this.isShiftingMarket = true;
          uiLog(`Completed ${purchasesCompleted}/${tradesPerSignal} buys — initiating safe shift...`, this.currentSymbol);

          const next = this.nextMarketSymbol();
          const summary = {
            market: `${findMarketMeta(this.currentSymbol).sym} – ${findMarketMeta(this.currentSymbol).name}`,
            timeframe: this.marketState.timeframeStr(),
            signals: this.marketState.signals,
            trades: this.marketState.trades,
            wins: this.marketState.wins,
            losses: this.marketState.losses,
            net_pl: this.pnl,
            avg_stake: this.marketState.stakes.length ? (this.marketState.stakes.reduce((a,b)=>a+b,0)/this.marketState.stakes.length) : 0,
            ignored: this.marketState.ignored,
            nextMarket: `${findMarketMeta(next).sym} – ${findMarketMeta(next).name}`,
            ccy: this.currency
          };

          // overlay 10s
          await showShiftOverlay(summary, 10);

          // subscribe to new market (still in shifting blind-phase until subscribe returns)
          await this.changeMarket(next);

          uiLog(`Shift complete. Entered market ${this.currentSymbol}`, "SHIFT");
        } catch (e) {
          uiLog(`Error during safe shift: ${String(e?.message || e)}`, "SHIFT");
        } finally {
          this.isShiftingMarket = false;
          this.tradesExecutedThisMarket = 0;
        }
      } else {
        uiLog(`Did not complete full set (${purchasesCompleted}/${tradesPerSignal}). No market shift.`, "CYCLE");
      }
    }

    // Old synchronous fallback (kept but not used by main fast path)
    async oneDigitDifferTrade(symbol, barrierDigit, amount) {
      try {
        const proposal = await this.deriv.send({
          proposal: 1,
          amount: Number(amount.toFixed(2)),
          basis: "stake",
          contract_type: "DIGITDIFF",
          currency: this.currency || "USD",
          duration: 1,
          duration_unit: "t",
          symbol,
          barrier: String(barrierDigit)
        });
        const proposalId = proposal?.proposal?.id;
        if (!proposalId) throw new Error("Proposal failed");
        const buy = await this.deriv.send({ buy: proposalId, price: Number(amount.toFixed(2)) });
        const contract_id = buy?.buy?.contract_id;
        if (!contract_id) throw new Error("Buy failed (no contract_id)");
        this.contractMap.set(contract_id, {
          stake: amount,
          symbol,
          barrier: barrierDigit,
          bought_at: Date.now(),
          symbolState: this.marketState
        });
        return { contract_id, buy_price: buy?.buy?.buy_price || 0 };
      } catch (e) {
        uiLog(`Buy failed (fallback): ${String(e?.message || e)}`, "BUY");
        return null;
      }
    }

    nextMarketSymbol() {
      if (this.rotationMode === "random") {
        const others = MARKETS.map(m => m.sym).filter(s => s !== this.currentSymbol);
        return others[Math.floor(Math.random() * others.length)];
      }
      this.seriesIdx = (this.seriesIdx + 1) % MARKETS.length;
      return MARKETS[this.seriesIdx].sym;
    }

    async changeMarket(symbol) {
      try { await this.forgetAll("ticks"); } catch (_) { }
      this.tickSubId = null;
      this.currentSymbol = symbol;
      if (this.$marketSelect) this.$marketSelect.value = symbol;
      if (marketName) marketName.textContent = `${findMarketMeta(symbol).sym} – ${findMarketMeta(symbol).name}`;
      await this.subscribeMarket(symbol);
      toast({ title: "Market changed", msg: `Now streaming ${symbol}`, ok: true });
    }

    async toggleStart(on) {
      this.tradingEnabled = !!on;
      if (this.tradingEnabled) {
        toast({ title: "Trading ENABLED", msg: "Bot will trade on next armed valid signal." });
        uiLog("Trading enabled. Waiting for valid signal…", "STATE");
      } else {
        toast({ title: "Trading STOPPED", msg: "No new trades will be placed.", ok: false });
        uiLog("Trading stopped by user.", "STATE");
      }
    }

    async forgetAll(stream) {
      try { await this.deriv.send({ forget_all: stream }); } catch (_) { }
    }

    renderAll() {
      try {
        renderLast7(this.marketState.last7);
        const total = this.marketState.queue.length;
        renderDistribution(this.marketState.counts, total);
        if (this.balance !== undefined && balanceVal) balanceVal.textContent = (this.balance || 0).toFixed(2);
        if (pnlVal) pnlVal.textContent = (this.pnl || 0).toFixed(2);
        if (marketName) marketName.textContent = `${findMarketMeta(this.currentSymbol).sym} – ${findMarketMeta(this.currentSymbol).name}`;
      } catch (e) { /* ignore */ }
    }
  }

  // instantiate and expose for debugging
  const bot = new RiskTakerBot();
  window.RTBot = bot;

})();