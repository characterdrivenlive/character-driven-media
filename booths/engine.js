/* Character Driven Studio — TEST booth engine (browser only).
   Real: microphone input (clean, no browser voice processing), Web Audio mix, faders, MUTE, SOLO (headphones only),
   meters from real signal, music decks from local files, WAV recording (48 kHz / 24-bit), offline WAV export.
   Not connected: station relay, guests, telephone, PartyLine, server storage. Those show a dash or "Not in TEST". */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const dbPct = db => (db === null || !isFinite(db)) ? 0 : Math.max(0, Math.min(100, (db + 60) / 60 * 100));
  const fmtDb = db => (db === null || !isFinite(db) || db < -59.5) ? '—' : (db >= 0 ? '+' : '') + db.toFixed(0) + ' dB';
  const fromDb = db => Math.pow(10, db / 20);

  function rmsDb(an, buf) {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const r = Math.sqrt(s / buf.length);
    return r > 0 ? 20 * Math.log10(r) : -Infinity;
  }

  /* ---------- WAV (24-bit PCM) ---------- */
  function wav24(chans, sr) {
    const n = chans[0].length, nc = chans.length, ba = nc * 3;
    const buf = new ArrayBuffer(44 + n * ba), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * ba, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ba, true); dv.setUint16(32, ba, true); dv.setUint16(34, 24, true);
    w(36, 'data'); dv.setUint32(40, n * ba, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      let v = Math.max(-1, Math.min(1, chans[c][i]));
      v = Math.round(v < 0 ? v * 0x800000 : v * 0x7fffff);
      dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); o += 3;
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function joinChunks(chunks, nc) {
    const len = chunks.reduce((a, c) => a + c[0].length, 0);
    const out = Array.from({ length: nc }, () => new Float32Array(len));
    let o = 0;
    for (const c of chunks) { for (let k = 0; k < nc; k++) out[k].set(c[Math.min(k, c.length - 1)], o); o += c[0].length; }
    return out;
  }

  const CAPTURE_SRC = `class CdCap extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=e=>{this.on=e.data}}
process(i){const x=i[0];if(this.on&&x&&x.length){this.port.postMessage(x.map(c=>c.slice(0)))}return true}}registerProcessor('cd-cap',CdCap);`;

  /* ---------- Engine ---------- */
  class Engine {
    constructor() { this.ctx = null; this.channels = []; this.headphones = false; this.meterHooks = []; }
    async start() {
      if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' });
      this.ctx = ctx;
      this.bus = ctx.createGain();
      this.cue = ctx.createGain();
      // Glue Mix (bypassed by default): parallel wet/dry
      this.glue = ctx.createDynamicsCompressor();
      Object.assign(this.glue, {});
      this.glue.threshold.value = -18; this.glue.ratio.value = 2; this.glue.attack.value = 0.01; this.glue.release.value = 0.25; this.glue.knee.value = 6;
      this.glueMake = ctx.createGain(); this.glueWet = ctx.createGain(); this.glueDry = ctx.createGain();
      this.glueWet.gain.value = 0; this.glueDry.gain.value = 1;
      this.busOut = ctx.createGain();
      this.bus.connect(this.glueDry).connect(this.busOut);
      this.bus.connect(this.glue).connect(this.glueMake).connect(this.glueWet).connect(this.busOut);
      // Show limiter about -1 dBFS
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
      this.master = ctx.createGain();
      this.busOut.connect(this.limiter).connect(this.master);
      this.masterAn = ctx.createAnalyser(); this.masterAn.fftSize = 2048;
      this.master.connect(this.masterAn);
      // Monitor: mix, or SOLO cue when anything is soloed; silent until headphones are confirmed
      this.mixMon = ctx.createGain(); this.cueMon = ctx.createGain(); this.cueMon.gain.value = 0;
      this.monitor = ctx.createGain(); this.monitor.gain.value = 0;
      this.master.connect(this.mixMon).connect(this.monitor);
      this.cue.connect(this.cueMon).connect(this.monitor);
      this.monAn = ctx.createAnalyser(); this.monAn.fftSize = 2048;
      this.monitor.connect(this.monAn);
      this.monitor.connect(ctx.destination);
      // Capture worklet
      const url = URL.createObjectURL(new Blob([CAPTURE_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      this.sink = ctx.createGain(); this.sink.gain.value = 0; this.sink.connect(ctx.destination);
      this.buf = new Float32Array(2048);
      this.channels.forEach(ch => this._build(ch));
      if (this.masterDb !== undefined) this.master.gain.value = this.masterDb <= -60 ? 0 : fromDb(this.masterDb);
      const loop = () => { this._meters(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    setHeadphones(on) { this.headphones = on; if (this.ctx) this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02); }
    addChannel(opts) {
      const ch = Object.assign({ db: 0, muted: false, soloed: false, kind: 'line', available: true, el: null }, opts);
      this.channels.push(ch);
      if (this.ctx) this._build(ch);
      return ch;
    }
    _build(ch) {
      if (ch.built || !ch.available) return;
      const ctx = this.ctx;
      ch.input = ctx.createGain();
      ch.fader = ctx.createGain(); ch.fader.gain.value = fromDb(ch.db);
      ch.mute = ctx.createGain(); ch.mute.gain.value = ch.muted ? 0 : 1;
      ch.an = ctx.createAnalyser(); ch.an.fftSize = 2048;
      ch.solo = ctx.createGain(); ch.solo.gain.value = 0;
      ch.input.connect(ch.fader).connect(ch.mute).connect(ch.an);
      ch.mute.connect(this.bus);
      ch.mute.connect(ch.solo).connect(this.cue);
      ch.built = true;
      if (ch.onBuild) ch.onBuild(ch);
    }
    setFader(ch, db) { ch.db = db; if (ch.fader) ch.fader.gain.setTargetAtTime(db <= -60 ? 0 : fromDb(db), this.ctx.currentTime, 0.01); }
    setMasterDb(db) { this.masterDb = db; if (this.master) this.master.gain.setTargetAtTime(db <= -60 ? 0 : fromDb(db), this.ctx.currentTime, 0.01); }
    setMute(ch, on) { ch.muted = on; if (ch.mute) ch.mute.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.005); }
    setSolo(ch, on) {
      ch.soloed = on;
      if (ch.solo) ch.solo.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.005);
      const any = this.channels.some(c => c.soloed);
      if (this.ctx) { this.mixMon.gain.setTargetAtTime(any ? 0 : 1, this.ctx.currentTime, 0.005); this.cueMon.gain.setTargetAtTime(any ? 1 : 0, this.ctx.currentTime, 0.005); }
    }
    setGlue(o) {
      if (!this.ctx) return;
      if ('bypass' in o) { this.glueWet.gain.value = o.bypass ? 0 : 1; this.glueDry.gain.value = o.bypass ? 1 : 0; this.glueBypassed = o.bypass; }
      if (o.ratio) this.glue.ratio.value = o.ratio;
      if (o.threshold !== undefined) this.glue.threshold.value = o.threshold;
      if (o.makeup !== undefined) this.glueMake.gain.value = fromDb(o.makeup);
    }
    async connectMic(ch, deviceId) {
      await this.start();
      if (ch.stream) ch.stream.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      ch.stream = stream;
      if (ch.src) ch.src.disconnect();
      ch.src = this.ctx.createMediaStreamSource(stream);
      ch.src.connect(ch.input);
      ch.connected = true; ch.label = stream.getAudioTracks()[0].label || 'Microphone';
      return ch;
    }
    async devices() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) { return []; } }
    _meters() {
      for (const ch of this.channels) {
        if (!ch.el || !ch.an) continue;
        const db = rmsDb(ch.an, this.buf);
        ch.level = db;
        if (db > -50) ch.heard = true;
        ch.el.vu.style.height = dbPct(db) + '%';
      }
      this.masterLevel = this.masterAn ? rmsDb(this.masterAn, this.buf) : null;
      this.monLevel = this.monAn ? rmsDb(this.monAn, this.buf) : null;
      this.meterHooks.forEach(f => f(this));
    }
    /* Recorder: session mix (stereo) + a clean track per connected microphone, as 48 kHz / 24-bit WAV */
    async recStart() {
      await this.start();
      const mk = (src, nc) => {
        const node = new AudioWorkletNode(this.ctx, 'cd-cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: nc, channelCountMode: 'explicit' });
        const chunks = [];
        node.port.onmessage = e => chunks.push(e.data);
        src.connect(node); node.connect(this.sink); node.port.postMessage(true);
        return { node, chunks, nc, src };
      };
      this.rec = { started: Date.now(), parts: [{ name: 'Session mix', cap: mk(this.master, 2) }] };
      for (const ch of this.channels) if (ch.src) this.rec.parts.push({ name: ch.name + ' (clean)', cap: mk(ch.src, 1) });
    }
    recStop() {
      const r = this.rec; if (!r) return [];
      this.rec = null;
      return r.parts.map(p => {
        p.cap.node.port.postMessage(false);
        try { p.cap.src.disconnect(p.cap.node); } catch (e) {}
        p.cap.node.disconnect();
        const data = joinChunks(p.cap.chunks, p.cap.nc);
        const secs = data[0].length / this.ctx.sampleRate;
        return { name: p.name, blob: wav24(data, this.ctx.sampleRate), secs };
      });
    }
  }

  /* ---------- Music decks ---------- */
  class Deck {
    constructor(engine, ch, opts) { Object.assign(this, { engine, ch, loop: false, buffer: null, playing: false, offset: 0, xf: 1, name: '' }, opts); }
    async load(file) {
      await this.engine.start();
      const arr = await file.arrayBuffer();
      this.buffer = await this.engine.ctx.decodeAudioData(arr);
      this.name = file.name.replace(/\.[^.]+$/, ''); this.offset = 0;
      if (!this.gain) { this.gain = this.engine.ctx.createGain(); this.gain.connect(this.ch.input); }
      this.applyXf();
    }
    applyXf() { if (this.gain) this.gain.gain.value = this.xf * (this.muted ? 0 : 1); }
    play() {
      if (!this.buffer || this.playing) return;
      if (this.engine.ctx.state !== 'running') this.engine.ctx.resume();
      const s = this.engine.ctx.createBufferSource(); s.buffer = this.buffer; s.loop = this.loop; s.connect(this.gain);
      s.onended = () => { if (this.src === s && !this.loop) { this.playing = false; this.offset = 0; this.onchange && this.onchange(); } };
      s.start(0, this.offset % this.buffer.duration); this.src = s; this.t0 = this.engine.ctx.currentTime - this.offset; this.playing = true;
    }
    stop() { if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch (e) {} } this.playing = false; this.offset = 0; }
    pos() { return !this.buffer ? 0 : this.playing ? (this.engine.ctx.currentTime - this.t0) % this.buffer.duration : this.offset; }
  }

  /* ---------- UI helpers ---------- */
  const fmtTime = s => { s = Math.max(0, s || 0); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };

  function stripHTML(ch, isMaster) {
    const dis = ch.available ? '' : ' disabled';
    return `<div class="strip${isMaster ? ' master' : ''}${ch.available ? '' : ' na'}" data-ch="${ch.id}">
      <div class="lab">${ch.name}</div><div class="model">${ch.available ? (ch.model || '') : 'Not in TEST'}</div>
      <div class="fz"><div class="vu"><i style="height:0%"></i></div>
      <input class="vfader" type="range" min="-60" max="10" step="0.5" value="${ch.db}" aria-label="${ch.name} fader"${dis}></div>
      <div class="db">${ch.available ? (ch.db >= 0 ? '+' : '') + ch.db.toFixed(1) + ' dB' : '—'}</div>
      <button class="ring mute" aria-pressed="${ch.muted}" aria-label="Mute ${ch.name}"${dis}>MUTE</button>
      ${isMaster ? '' : `<button class="ring solo" aria-pressed="${ch.soloed}" aria-label="Solo ${ch.name} in headphones"${dis}>SOLO</button>`}
      <button class="chev" aria-label="${ch.name} detail"${dis}>⌄</button></div>`;
  }
  function renderStrips(engine, container, masterCh) {
    const list = engine.channels.filter(c => !c.hidden);
    container.innerHTML = list.map(c => stripHTML(c, false)).join('') + stripHTML(masterCh, true);
    const bind = (ch, isMaster) => {
      const el = container.querySelector(`[data-ch="${ch.id}"]`);
      ch.el = { root: el, vu: el.querySelector('.vu i'), db: el.querySelector('.db') };
      const f = el.querySelector('.vfader');
      f.addEventListener('input', () => {
        const v = +f.value; ch.el.db.textContent = v <= -60 ? '−∞' : (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
        ch.db = v; if (isMaster) engine.masterDb = v;
        if (!engine.ctx) return; isMaster ? engine.setMasterDb(v) : engine.setFader(ch, v);
      });
      const m = el.querySelector('.mute');
      m.addEventListener('click', async () => { await engine.start(); const on = m.getAttribute('aria-pressed') !== 'true'; m.setAttribute('aria-pressed', on); ch.muted = on;
        if (isMaster) engine.master.gain.setTargetAtTime(on ? 0 : fromDb(engine.masterDb || 0), engine.ctx.currentTime, 0.005); else engine.setMute(ch, on); });
      const s = el.querySelector('.solo');
      if (s) s.addEventListener('click', async () => { await engine.start(); const on = s.getAttribute('aria-pressed') !== 'true'; s.setAttribute('aria-pressed', on); engine.setSolo(ch, on); });
    };
    list.filter(c => c.available).forEach(c => bind(c, false));
    // master strip meter shows the master analyser
    const mel = container.querySelector(`[data-ch="${masterCh.id}"]`);
    masterCh.el = { root: mel, vu: mel.querySelector('.vu i'), db: mel.querySelector('.db') };
    bind(masterCh, true);
    engine.meterHooks = engine.meterHooks.filter(h => !h.isMasterStrip);
    const mh = e => { masterCh.el.vu.style.height = dbPct(e.masterLevel) + '%'; }; mh.isMasterStrip = true;
    engine.meterHooks.push(mh);
  }
  function seg(el, db) { if (el) el.style.width = dbPct(db) + '%'; }

  /* Generic state button: tap and 1.5 s hold transitions */
  function stateButton(btn, cfg) {
    const fill = btn.querySelector('.fill'), word = btn.querySelector('.word'), hint = btn.querySelector('.hint');
    const HOLD = cfg.hold || 1500;
    let state = cfg.initial, hs = 0, raf = 0, held = false;
    const api = {
      get state() { return state; },
      set(s, extraHint) { state = s; const d = cfg.states[s]; btn.dataset.state = d.look; word.textContent = d.word; hint.textContent = extraHint || d.hint;
        btn.setAttribute('aria-label', d.word + '. ' + (extraHint || d.hint)); cfg.onEnter && cfg.onEnter(s); }
    };
    function frame() {
      const p = Math.min(1, (Date.now() - hs) / HOLD); fill.style.width = p * 100 + '%';
      if (p >= 1) { held = true; stopHold(); const d = cfg.states[state]; d.onHold && d.onHold(api); return; }
      raf = requestAnimationFrame(frame);
    }
    function startHold() { if (!cfg.states[state].onHold) return; hs = Date.now(); held = false; raf = requestAnimationFrame(frame); }
    function stopHold() { cancelAnimationFrame(raf); fill.style.width = '0'; }
    function tap() { const d = cfg.states[state]; d.onTap && d.onTap(api); }
    btn.addEventListener('pointerdown', startHold);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stopHold));
    btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(); } });
    btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { stopHold(); if (!held) tap(); held = false; } });
    btn.addEventListener('click', e => { if (e.detail === 0) return; if (!held) tap(); held = false; });
    api.set(state);
    return api;
  }

  /* Shell wiring common to every room: main tabs, rail tabs, tool drawers, sub-tabs */
  function shell() {
    $$('.room-tab[data-room]').forEach(t => t.addEventListener('click', () => {
      $$('.room-tab[data-room]').forEach(o => o.setAttribute('aria-selected', o === t));
      ['console', 'backstage', 'library'].forEach(r => { const s = $('#room-' + r); if (s) s.hidden = r !== t.dataset.room; });
    }));
    $$('.src-tab').forEach(t => t.addEventListener('click', () => {
      $$('.src-tab').forEach(o => o.setAttribute('aria-selected', o === t));
      $$('[data-srclist]').forEach(l => l.hidden = l.dataset.srclist !== t.dataset.src);
    }));
    const tools = $$('.tool');
    const open = n => { tools.forEach(t => t.setAttribute('aria-pressed', t.dataset.tool === n)); $$('.drawer').forEach(d => d.hidden = d.dataset.panel !== n); };
    tools.forEach(t => t.addEventListener('click', () => open(t.getAttribute('aria-pressed') === 'true' ? null : t.dataset.tool)));
    $$('.x').forEach(x => x.addEventListener('click', () => open(null)));
    $$('.subtabs').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('.subtab'); if (!b) return;
      g.querySelectorAll('.subtab').forEach(o => o.setAttribute('aria-pressed', o === b));
      const host = g.parentElement; $$('[data-sub]', host).forEach(p => p.hidden = p.dataset.sub !== b.dataset.view); }));
  }

  /* Deck UI: binds one .deck card */
  function bindDeck(deck, card) {
    const file = card.querySelector('input[type=file]'), t = card.querySelector('.t'), time = card.querySelector('.mini');
    const play = card.querySelector('[data-act=play]'), stop = card.querySelector('[data-act=stop]'), mute = card.querySelector('.ring.mute');
    const refresh = () => { t.textContent = deck.label + ' · ' + (deck.name || 'empty'); play.disabled = stop.disabled = !deck.buffer;
      play.textContent = deck.playing ? '❚❚' : '▶'; deck.onui && deck.onui(); };
    deck.onchange = refresh;
    file.addEventListener('change', async () => { if (!file.files[0]) return; t.textContent = deck.label + ' · loading…';
      try { await deck.load(file.files[0]); } catch (e) { t.textContent = deck.label + ' · could not read that file'; return; } refresh(); });
    play.addEventListener('click', () => { if (deck.playing) { deck.offset = deck.pos(); const o = deck.offset; deck.stop(); deck.offset = o; } else deck.play(); refresh(); });
    stop.addEventListener('click', () => { deck.stop(); refresh(); });
    if (mute) mute.addEventListener('click', () => { deck.muted = mute.getAttribute('aria-pressed') !== 'true'; mute.setAttribute('aria-pressed', deck.muted); deck.applyXf(); });
    setInterval(() => { if (deck.buffer) time.textContent = fmtTime(deck.pos()) + ' / ' + fmtTime(deck.buffer.duration); }, 250);
    refresh();
  }

  function downloadLink(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.className = 'chip cy'; a.textContent = 'Download'; return a;
  }

  window.CDB = { Engine, Deck, renderStrips, stateButton, shell, bindDeck, seg, dbPct, fmtDb, fmtTime, wav24, downloadLink, $, $$ };
})();
