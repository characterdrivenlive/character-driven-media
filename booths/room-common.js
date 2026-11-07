/* Shared wiring for the Broadcast and Recording TEST booths. */
(function () {
  'use strict';
  const { Engine, Deck, renderStrips, shell, bindDeck, seg, fmtDb, fmtTime, downloadLink, $, $$ } = CDB;

  function setup(opts) {
    const e = new Engine();
    const R = { engine: e, decks: {}, takes: 0 };
    const host = e.addChannel({ id: 'host', name: 'Host mic', kind: 'mic', model: 'Flat · clean' });
    (opts.extra || []).forEach(x => e.addChannel(Object.assign({ db: 0 }, x)));
    const decksCh = opts.decks ? e.addChannel({ id: 'decks', name: 'Music decks', model: 'Decks A–D', db: -6 }) : null;
    const bedCh = opts.bed ? e.addChannel({ id: 'bed', name: 'Music Bed', model: 'Loop', db: -14 }) : null;
    const master = { id: 'master', name: opts.masterName || 'Master', db: 0, muted: false, available: true, model: 'Limiter −1 dBFS' };
    R.host = host;
    shell();
    renderStrips(e, $('#strips'), master);

    // Start sound
    const startBtn = $('#start');
    async function startSound() {
      await e.start();
      startBtn.textContent = 'Sound on'; startBtn.disabled = true;
      $('#p-sound').textContent = 'Sound on'; $('#p-sound-dot').className = 'dot g';
      fillDevices();
    }
    startBtn.addEventListener('click', () => startSound().catch(err => alertMsg('Sound could not start: ' + err.message)));

    function alertMsg(t) { const n = $('#host-sub'); if (n) n.textContent = t; }

    // Microphone
    async function connect(deviceId) {
      try {
        await startSound();
        await e.connectMic(host, deviceId);
        $('#host-tally').className = 'tally live'; $('#host-tally').textContent = 'LIVE';
        $('#host-sub').textContent = host.label; $('#src-host').classList.add('live');
        $('#connect-mic').textContent = 'Change microphone';
        fillDevices();
      } catch (err) {
        alertMsg(err.name === 'NotAllowedError' ? 'Microphone blocked. Allow it in the browser address bar, then try again.' : 'Microphone error: ' + err.message);
      }
    }
    $('#connect-mic').addEventListener('click', () => connect($('#dev') ? $('#dev').value : undefined));
    async function fillDevices() {
      const sel = $('#dev'); if (!sel) return;
      const list = await e.devices(); const cur = sel.value;
      sel.innerHTML = '<option value="">Default microphone</option>' + list.map(d => `<option value="${d.deviceId}">${d.label || 'Microphone'}</option>`).join('');
      sel.value = cur;
    }
    if ($('#dev-apply')) $('#dev-apply').addEventListener('click', () => connect($('#dev').value));

    // Checks
    const phones = $('#chk-phones');
    phones.addEventListener('click', async () => {
      const on = phones.getAttribute('aria-pressed') !== 'true';
      phones.setAttribute('aria-pressed', on);
      phones.textContent = on ? 'Headphones ✓' : 'Headphones? tap to confirm';
      if (on) await startSound();
      e.setHeadphones(on); R.onChecks && R.onChecks();
    });
    R.checksOk = () => {
      const base = host.connected && host.heard && phones.getAttribute('aria-pressed') === 'true';
      return base && (!R.extraCheck || R.extraCheck());
    };
    setInterval(() => {
      const m = $('#chk-mic'); const ok = host.connected && host.heard;
      m.setAttribute('aria-pressed', ok); m.textContent = ok ? 'Mic ✓' : host.connected ? 'Mic: speak to test' : 'Mic ✕';
      R.onChecks && R.onChecks();
    }, 400);

    // Cue monitor + master readout
    e.meterHooks.push(x => {
      const hp = x.headphones;
      const lvl = hp ? x.monLevel : null;
      seg($('#cue-l'), lvl); seg($('#cue-r'), lvl);
      $('#cue-l-db').textContent = fmtDb(lvl); $('#cue-r-db').textContent = fmtDb(lvl);
      const solo = x.channels.filter(c => c.soloed).map(c => c.name);
      $('#cue-now').textContent = !hp ? 'Headphones not confirmed' : solo.length ? 'SOLO: ' + solo.join(', ') : 'Full mix';
      $('#cue-tag').textContent = solo.length ? 'SOLO' : 'MIX';
      $('#s-master').textContent = fmtDb(x.masterLevel);
    });

    // Decks
    if (decksCh) {
      $('#decks').innerHTML = opts.decks.map(k => `<div class="deck" data-deck="${k}"><div class="t">${k} · empty</div><div class="mini">00:00 / 00:00</div>
        <input type="file" accept="audio/*" aria-label="Load deck ${k}">
        <div class="row"><button class="sq" data-act="play" aria-label="Play deck ${k}">▶</button><button class="sq" data-act="stop" aria-label="Stop deck ${k}">■</button><button class="ring mute" aria-pressed="false" aria-label="Mute deck ${k}">MUTE</button></div></div>`).join('');
      opts.decks.forEach(k => {
        const d = new Deck(e, decksCh, { label: k });
        d.onui = () => { const t = $('#tal-' + k); if (!t) return; $('#rail-' + k).textContent = 'Deck ' + k + (d.name ? ' · ' + d.name : '');
          t.className = 'tally' + (d.playing ? ' live' : ''); t.textContent = !d.buffer ? 'EMPTY' : d.playing ? 'PLAYING' : 'READY'; };
        R.decks[k] = d; bindDeck(d, $(`[data-deck="${k}"]`));
      });
      const xf = $('#xf');
      const applyXf = () => { const v = +xf.value; if (R.decks.A) { R.decks.A.xf = Math.cos(v * Math.PI / 2); R.decks.A.applyXf(); } if (R.decks.B) { R.decks.B.xf = Math.sin(v * Math.PI / 2); R.decks.B.applyXf(); } };
      xf.addEventListener('input', applyXf); applyXf();
    }
    if (bedCh) {
      const bed = new Deck(e, bedCh, { label: 'Music Bed', loop: true });
      bed.onui = () => { const t = $('#tal-bed'); if (!t) return; $('#rail-bed').textContent = 'Music Bed' + (bed.name ? ' · ' + bed.name : '');
        t.className = 'tally' + (bed.playing ? ' live' : ''); t.textContent = !bed.buffer ? 'EMPTY' : bed.playing ? 'LOOPING' : 'READY'; };
      R.decks.bed = bed; bindDeck(bed, $('#bed-card'));
    }
    if ($('#stop-all')) $('#stop-all').addEventListener('click', () => Object.values(R.decks).forEach(d => { d.stop(); d.onchange && d.onchange(); }));
    if ($('#copy-listen')) $('#copy-listen').addEventListener('click', ev => { navigator.clipboard.writeText('https://www.characterdriven.live/listen').then(() => ev.target.textContent = 'Copied', () => {}); });

    // Recordings list
    R.addTake = (parts, label) => {
      const box = $('#recs'); if (!box) return;
      if (box.querySelector('p.mini')) box.innerHTML = '';
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
      parts.forEach(p => {
        const row = document.createElement('div'); row.className = 'item';
        row.innerHTML = `<div><div class="k">${label} · ${p.name}</div><div class="v">${fmtTime(p.secs)} · WAV 48 kHz / 24-bit · ${(p.blob.size / 1048576).toFixed(1)} MB · in this tab only</div></div>`;
        row.appendChild(downloadLink(p.blob, `${label.replace(/\W+/g, '-')}-${p.name.replace(/\W+/g, '-')}-${stamp}.wav`));
        box.prepend(row);
      });
    };
    R.simpleRecord = (btn, status) => {
      btn.addEventListener('click', async () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        if (on) { await e.recStart(); R.takes++; }
        else { const parts = e.recStop(); R.addTake(parts, 'Take ' + R.takes); }
        btn.setAttribute('aria-pressed', on); btn.textContent = on ? 'Stop recording' : 'Record';
        status.className = 'state ' + (on ? 'rec' : 'off'); status.textContent = on ? 'RECORDING' : 'RECORDING OFF';
      });
    };
    return R;
  }
  window.CDRoom = { setup };
})();
