/* Tableau de bord des gateways. Tout le JS de la page, sans dependance.

   Regle qui gouverne ce fichier : LA PAGE NE SAIT RIEN. Les noms des
   variantes, leurs roles, leurs ports, ce qui est a nous et ce qui ne l'est
   pas — tout vient du payload pousse par le mac. Ce depot est public ; s'il
   fallait y coder un nom de variante, c'est que le payload doit changer.

   Deuxieme regle, celle qui evite de mentir : deux horloges cohabitent. Les
   compteurs de /health repartent de zero a chaque redemarrage d'une variante,
   le journal des tours non. Tout ce qui est « depuis le demarrage » est
   libelle comme tel, avec l'age du demarrage a cote — sinon un kickstart de
   ce matin se lirait comme une journee sans erreur. */

const REFRESH_MS = 60_000;
// L'export tourne toutes les 5 min ; au-dela de 15, ce n'est plus un
// instantane et la page doit le dire plutot que d'afficher des cartes vertes.
const STALE_S = 15 * 60;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined) n.textContent = txt;
  return n;
};

let DATA = null;
let VIEW = (location.hash.replace('#', '') === 'week') ? 'week' : 'day';

/* --- Formatage ----------------------------------------------------------- */

const NF = new Intl.NumberFormat('fr-FR');

function tokens(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' G';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
  if (n >= 1e4) return Math.round(n / 1e3) + ' k';
  return NF.format(n);
}

function duration(s) {
  if (s === null || s === undefined) return '—';
  s = Math.round(s);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 48) return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  return Math.floor(h / 24) + ' j';
}

function since(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

function clock(ts) {
  // `resets_at` est un epoch en secondes cote gateway.
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/* --- Fenetre affichee ---------------------------------------------------- */

function windowHours() {
  // `day` = les 24 dernieres heures, decoupees dans la meme serie ; une
  // seconde serie cote export n'apporterait rien et pourrait diverger.
  const hours = DATA.series.hours;
  return VIEW === 'day' ? Math.min(24, hours.length) : hours.length;
}

function sliceOf(variantId) {
  const n = windowHours();
  const arr = DATA.series.by_variant[variantId] || [];
  return arr.slice(arr.length - n);
}

function sumSlices() {
  const n = windowHours();
  const out = [];
  for (let i = 0; i < n; i++) out.push({ turns: 0, in: 0, cache_read: 0, cache_creation: 0, out: 0 });
  for (const id of Object.keys(DATA.series.by_variant)) {
    sliceOf(id).forEach((h, i) => {
      out[i].turns += h.turns; out[i].in += h.in;
      out[i].cache_read += h.cache_read; out[i].cache_creation += h.cache_creation;
      out[i].out += h.out;
    });
  }
  return out;
}

function windowTotal() {
  return sumSlices().reduce((a, h) => ({
    turns: a.turns + h.turns, in: a.in + h.in,
    cache_read: a.cache_read + h.cache_read,
    cache_creation: a.cache_creation + h.cache_creation, out: a.out + h.out,
  }), { turns: 0, in: 0, cache_read: 0, cache_creation: 0, out: 0 });
}

/* --- Dessin -------------------------------------------------------------- */

const W = 1000, H = 120;

function svg(h) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', `0 0 ${W} ${h}`);
  s.setAttribute('preserveAspectRatio', 'none');
  return s;
}

function rect(x, y, w, h, varname) {
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('x', x); r.setAttribute('y', y);
  r.setAttribute('width', Math.max(0, w)); r.setAttribute('height', Math.max(0, h));
  // La couleur vient du CSS, jamais d'un litteral ici.
  r.setAttribute('fill', `var(${varname})`);
  return r;
}

function stackedChart(rows) {
  /* Barres empilees, une par heure. Les heures sans tour EXISTENT et valent
     zero : une courbe qui saute les cases vides fait ressembler un trou a un
     calme, et ce ne sont pas les memes nouvelles. */
  const s = svg(H);
  const max = Math.max(1, ...rows.map(r => r.in + r.cache_read + r.cache_creation + r.out));
  const bw = W / rows.length;
  rows.forEach((r, i) => {
    const x = i * bw + bw * 0.12;
    const w = bw * 0.76;
    let y = H;
    for (const [key, color] of [['out', '--tok-out'], ['in', '--tok-in'],
                                ['cache_creation', '--tok-cache'], ['cache_read', '--tok-cache']]) {
      const h = (r[key] / max) * (H - 2);
      y -= h;
      if (h > 0) s.appendChild(rect(x, y, w, h, color));
    }
  });
  return s;
}

function barsOf(rows, key, color, height) {
  /* Une grandeur, sa propre echelle. Empiler « produits » sous le cache le
     reduisait a un lisere : le geste qui coute le plus cher devenait le moins
     visible du dessin. */
  const s = svg(height);
  const max = Math.max(1, ...rows.map(r => r[key]));
  const bw = W / rows.length;
  rows.forEach((r, i) => {
    const h = (r[key] / max) * (height - 2);
    if (h > 0) s.appendChild(rect(i * bw + bw * 0.12, height - h, bw * 0.76, h, color));
  });
  return s;
}

function sparkline(rows) {
  /* Tours par heure d'une variante. Un histogramme et pas une courbe : entre
     deux heures il ne se passe rien a interpoler. */
  const h = 34;
  const s = svg(h);
  const max = Math.max(1, ...rows.map(r => r.turns));
  const bw = W / rows.length;
  rows.forEach((r, i) => {
    const bh = (r.turns / max) * (h - 2);
    if (bh > 0) s.appendChild(rect(i * bw + bw * 0.15, h - bh, bw * 0.7, bh, '--cool'));
  });
  return s;
}

/* --- Rendu --------------------------------------------------------------- */

function renderHeader() {
  const up = DATA.variants.filter(v => v.up).length;
  const total = DATA.variants.length;
  const t = windowTotal();
  const label = VIEW === 'day' ? "sur 24 h" : `sur ${DATA.window_days} j`;
  const synth = $('synth');
  synth.innerHTML = '';
  const add = (txt, bold) => {
    const n = bold ? el('b', null, txt) : document.createTextNode(txt);
    synth.appendChild(bold ? n : n);
  };
  add(up === total ? 'Les ' : '', false);
  add(`${up}/${total}`, true);
  add(up === total ? ' variantes en ligne · ' : ' variantes en ligne · ', false);
  add(NF.format(t.turns), true);
  add(` tours ${label} · `, false);
  add(tokens(t.in + t.cache_read + t.cache_creation + t.out), true);
  add(' tokens', false);

  const age = since(DATA.generated_at);
  const pill = $('freshness');
  pill.className = 'pill ' + (age > STALE_S ? 'stale' : 'fresh');
  pill.textContent = age > STALE_S
    ? `données vieilles de ${duration(age)}`
    : `à jour il y a ${duration(age)}`;
}

function renderBanners() {
  const box = $('banners');
  box.innerHTML = '';
  const age = since(DATA.generated_at);
  if (age > STALE_S) {
    box.appendChild(el('div', 'banner',
      `Le mac n'a rien poussé depuis ${duration(age)}. Tout ce qui suit décrit cet instant-là, pas maintenant.`));
  }
  const down = DATA.variants.filter(v => !v.up);
  if (down.length) {
    box.appendChild(el('div', 'banner',
      `Sans réponse : ${down.map(v => v.label).join(', ')}.`));
  }
  if (DATA.plan && DATA.plan.limited) {
    box.appendChild(el('div', 'banner',
      `Forfait saturé — la fenêtre se rouvre à ${clock(DATA.plan.resets_at)}.`));
  }
  const noisy = DATA.variants.filter(v => v.journal && (v.journal.errors || v.journal.dropped));
  if (noisy.length) {
    box.appendChild(el('div', 'banner warn',
      `Journal des tours incomplet sur ${noisy.map(v => v.label).join(', ')} : `
      + `des tours n'ont pas été écrits, la conso affichée est donc un minorant.`));
  }
  if (!DATA.journal.present) {
    box.appendChild(el('div', 'banner warn',
      `Aucun journal des tours sur le mac : seul l'instant est connu, pas l'historique.`));
  }
}

function renderPlan() {
  const box = $('plan');
  box.innerHTML = '';
  const p = DATA.plan;
  const card = el('section', 'plan');
  card.appendChild(el('h2', null, 'Forfait Max'));
  if (!p) {
    card.appendChild(el('p', 'sub',
      "Aucune variante n'a encore vu passer de réponse de l'API depuis son démarrage : la fenêtre en cours est inconnue."));
    box.appendChild(card);
    return;
  }
  const pct = (p.utilization === null || p.utilization === undefined) ? null : Math.round(p.utilization);
  card.appendChild(el('p', 'sub',
    pct === null
      ? `Fenêtre ${p.type || '—'} · consommation non communiquée par la dernière réponse.`
      : `Fenêtre ${p.type === 'five_hour' ? '5 h' : (p.type || '—')} · ${pct} % consommés, remise à zéro à ${clock(p.resets_at)}.`));
  if (pct !== null) {
    const g = el('div', 'gauge' + (pct >= 90 ? ' full' : pct >= 70 ? ' hot' : ''));
    const i = el('i');
    i.style.width = Math.min(100, pct) + '%';
    g.appendChild(i);
    card.appendChild(g);
    const legend = el('div', 'legend');
    legend.appendChild(el('span', null, `${pct} %`));
    legend.appendChild(el('span', null, `rouvre à ${clock(p.resets_at)}`));
    card.appendChild(legend);
  }
  card.appendChild(el('p', 'sub',
    `Lu sur « ${(DATA.variants.find(v => v.id === p.source) || {}).label || p.source} », `
    + `la variante qui a appelé le plus récemment — le forfait est commun à toutes.`));
  box.appendChild(card);
}

function variantCard(v) {
  const card = el('article', 'card' + (v.up ? '' : ' down') + (v.owner !== 'openclaw' ? ' foreign' : ''));

  const head = el('div', 'chead');
  head.appendChild(el('span', 'dot' + (v.up ? '' : ' down')));
  head.appendChild(el('h3', null, v.label));
  if (v.owner !== 'openclaw') head.appendChild(el('span', 'tag', v.owner));
  card.appendChild(head);
  card.appendChild(el('p', 'crole', v.role));

  if (!v.up) {
    card.appendChild(el('p', 'err', `Aucune réponse sur le port ${v.port} — ${v.error || 'motif inconnu'}.`));
    return card;
  }

  const kv = el('div', 'kv');
  const pair = (label, value) => {
    const d = el('div');
    d.appendChild(el('b', null, value));
    d.appendChild(document.createTextNode(' '));
    d.appendChild(el('span', null, label));
    kv.appendChild(d);
  };
  pair('en ligne', duration(v.uptime_s));
  if (v.queued !== null && v.queued !== undefined) pair(`en file (max ${v.max_queued})`, NF.format(v.queued));
  if (v.turn_duration && v.turn_duration.p50 !== undefined) pair('par tour (médiane)', duration(v.turn_duration.p50));
  card.appendChild(kv);

  if (v.llm) {
    const rows = sliceOf(v.id);
    const t = rows.reduce((a, h) => ({
      turns: a.turns + h.turns, in: a.in + h.in, out: a.out + h.out,
      cache_read: a.cache_read + h.cache_read, cache_creation: a.cache_creation + h.cache_creation,
    }), { turns: 0, in: 0, out: 0, cache_read: 0, cache_creation: 0 });
    const label = VIEW === 'day' ? '24 dernières heures' : `Sur ${DATA.window_days} jours`;
    card.appendChild(el('div', 'eyebrow', label));
    const kv2 = el('div', 'kv');
    const total = (t.in || 0) + (t.cache_read || 0) + (t.cache_creation || 0) + (t.out || 0);
    [['tours', NF.format(t.turns || 0)],
     ['tokens', tokens(total)],
     ['produits', tokens(t.out || 0)]].forEach(([l, val]) => {
      const d = el('div');
      d.appendChild(el('b', null, val));
      d.appendChild(document.createTextNode(' '));
      d.appendChild(el('span', null, l));
      kv2.appendChild(d);
    });
    card.appendChild(kv2);
    const sp = el('div', 'spark');
    sp.appendChild(sparkline(rows));
    card.appendChild(sp);
  } else {
    card.appendChild(el('div', 'eyebrow', 'Conso'));
    card.appendChild(el('p', 'crole', "Aucune : cette variante n'appelle pas de modèle."));
  }

  // Compteurs depuis le demarrage — libelles comme tels, avec l'age du
  // demarrage juste a cote : un kickstart de ce matin remet tout a zero, et
  // « 0 erreur » ne voudrait alors rien dire.
  const sb = v.since_boot || {};
  const hasCounters = Object.values(sb).some(x => x !== null && x !== undefined);
  if (hasCounters) {
  card.appendChild(el('div', 'eyebrow', `Depuis le démarrage, il y a ${duration(v.uptime_s)}`));
  const kv3 = el('div', 'kv');
  const maybe = (label, value) => {
    if (value === null || value === undefined) return;
    const d = el('div');
    d.appendChild(el('b', null, NF.format(value)));
    d.appendChild(document.createTextNode(' '));
    d.appendChild(el('span', null, label));
    kv3.appendChild(d);
  };
  maybe('tours', sb.turns);
  maybe('sessions reprises', sb.session_resumes);
  maybe('sessions recréées', sb.session_recreates);
  maybe('compactions', sb.cli_compactions);
  maybe('tours vides', sb.empty_turns);
  card.appendChild(kv3);
  }

  const anoms = (v.anomalies || []).filter(a => a.count > 0);
  if (anoms.length) {
    const box = el('div', 'anoms');
    anoms.forEach(a => box.appendChild(el('span', 'anom', `${a.label} : ${NF.format(a.count)}`)));
    card.appendChild(box);
  } else {
    card.appendChild(el('p', 'quiet', 'Aucune anomalie.'));
  }
  return card;
}

function renderVariants() {
  const box = $('variants');
  box.innerHTML = '';
  DATA.variants.forEach(v => box.appendChild(variantCard(v)));
}

function renderConso() {
  const box = $('conso');
  box.innerHTML = '';
  const card = el('section', 'conso');
  const rows = sumSlices();
  const t = windowTotal();
  card.appendChild(el('h2', null,
    VIEW === 'day' ? "Consommation des 24 dernières heures" : `Consommation sur ${DATA.window_days} jours`));
  card.appendChild(el('p', 'sub',
    `${NF.format(t.turns)} tours · ${tokens(t.out)} produits · ${tokens(t.in)} envoyés neufs · `
    + `${tokens(t.cache_read + t.cache_creation)} passés par le cache.`));

  card.appendChild(el('div', 'eyebrow', 'Produits par le modèle, par heure'));
  const out = el('div', 'chart chart-out');
  out.appendChild(barsOf(rows, 'out', '--tok-out', 78));
  card.appendChild(out);

  card.appendChild(el('div', 'eyebrow', 'Volume total reçu, cache compris'));
  const chart = el('div', 'chart');
  chart.appendChild(stackedChart(rows));
  card.appendChild(chart);

  const hours = DATA.series.hours.slice(DATA.series.hours.length - rows.length);
  const axis = el('div', 'axis');
  const fmt = (iso) => new Date(iso).toLocaleString('fr-FR',
    VIEW === 'day' ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit' });
  axis.appendChild(el('span', null, hours.length ? fmt(hours[0]) : ''));
  axis.appendChild(el('span', null, hours.length ? fmt(hours[hours.length - 1]) : ''));
  card.appendChild(axis);

  const peak = Math.max(...rows.map(r => r.out), 0);
  card.appendChild(el('p', 'sub',
    `Les deux dessins n'ont pas la même échelle : en haut le pic vaut ${tokens(peak)} produits en une heure, `
    + `en bas le volume total, dominé par le cache.`));

  const keys = el('div', 'keys');
  [['--tok-out', 'produits par le modèle'], ['--tok-in', 'envoyés neufs'],
   ['--tok-cache', 'lus ou écrits dans le cache']].forEach(([c, label]) => {
    const k = el('span');
    const i = el('i');
    i.style.background = `var(${c})`;
    k.appendChild(i);
    k.appendChild(document.createTextNode(label));
    keys.appendChild(k);
  });
  card.appendChild(keys);

  // Par modele : la seule lecture qui dise OU part le forfait. Toujours sur la
  // fenetre complete du payload, pas sur la vue — l'export ne detaille pas les
  // modeles heure par heure, et decouper ici inventerait un chiffre.
  if (DATA.models && DATA.models.length) {
    card.appendChild(el('div', 'eyebrow', `Par modèle, sur ${DATA.window_days} jours`));
    const table = el('table', 't');
    const thead = el('thead');
    const tr = el('tr');
    ['Modèle', 'Tours', 'Produits', 'Neufs', 'Cache'].forEach(h => tr.appendChild(el('th', null, h)));
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = el('tbody');
    DATA.models.forEach(m => {
      const r = el('tr');
      r.appendChild(el('td', null, m.id));
      r.appendChild(el('td', null, NF.format(m.turns)));
      r.appendChild(el('td', null, tokens(m.out)));
      r.appendChild(el('td', null, tokens(m.in)));
      r.appendChild(el('td', null, tokens(m.cache_read + m.cache_creation)));
      tbody.appendChild(r);
    });
    table.appendChild(tbody);
    card.appendChild(table);
  }
  box.appendChild(card);
}

function renderHelp() {
  const b = $('help-body');
  b.innerHTML = '';
  const p = (txt) => b.appendChild(el('p', null, txt));
  p("Chaque carte est une gateway : un service local qui parle à Claude sous le forfait Max au lieu de l'API facturée. Le point vert dit qu'elle répond, rien de plus.");
  p("Deux horloges, à ne pas confondre. « Aujourd'hui » et « sur 7 jours » viennent du journal des tours, qui survit aux redémarrages. Les compteurs « depuis le démarrage » repartent de zéro à chaque redémarrage de la variante — d'où l'âge affiché à côté.");
  p("Les tokens du cache sont presque toujours l'essentiel du volume : c'est du contexte relu, bien moins cher que ce que le modèle produit. Les trois natures ont chacune leur couleur pour cette raison.");
  p("La page est en lecture seule. Elle ne commande rien et rien n'entre depuis ici : le mac pousse son état, le conteneur le sert.");
}

function renderFooter() {
  fetch('build.txt', { cache: 'no-store' })
    .then(r => r.ok ? r.text() : '')
    .then(txt => {
      const parts = [];
      if (DATA) parts.push(`payload du ${new Date(DATA.generated_at).toLocaleString('fr-FR')}`);
      if (txt.trim()) parts.push(`page déployée le ${txt.trim()}`);
      $('foot-meta').textContent = parts.join(' · ');
    })
    .catch(() => {});
}

function renderAll() {
  renderHeader();
  renderBanners();
  renderPlan();
  renderVariants();
  renderConso();
  renderHelp();
  renderFooter();
}

/* --- Chargement ---------------------------------------------------------- */

function fail(msg) {
  $('synth').textContent = msg;
  $('freshness').className = 'pill stale';
  $('freshness').textContent = 'hors service';
}

async function load() {
  let r;
  try {
    r = await fetch('data.json', { cache: 'no-store' });
  } catch (e) {
    fail("Le serveur n'a pas répondu.");
    return;
  }
  if (r.status === 204) {
    fail("En attente du premier envoi depuis le mac.");
    return;
  }
  let payload;
  try {
    payload = await r.json();
  } catch (e) {
    fail("Le fichier de données est illisible.");
    return;
  }
  // Valider la FORME, pas le code HTTP : un chemin mal monté peut répondre 200
  // avec tout autre chose. Leçon déjà payée sur le dashboard maison.
  if (!payload || !Array.isArray(payload.variants) || !payload.series) {
    fail("Données inattendues — l'export n'a pas encore tourné ?");
    return;
  }
  DATA = payload;
  renderAll();
}

$('view').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  VIEW = b.dataset.view;
  location.hash = VIEW;
  [...$('view').querySelectorAll('button')].forEach(x =>
    x.setAttribute('aria-pressed', String(x.dataset.view === VIEW)));
  if (DATA) renderAll();
});

[...$('view').querySelectorAll('button')].forEach(x =>
  x.setAttribute('aria-pressed', String(x.dataset.view === VIEW)));

load();
setInterval(load, REFRESH_MS);
