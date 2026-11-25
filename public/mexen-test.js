// Mexen-testmodus: gooi N keer twee stenen met de dobbelsteenfunctie van het spel en toets of dat past bij
// eerlijke, onafhankelijke stenen. Elke toets geeft een p-waarde; bij p ≥ 0,01 is er op 99%-niveau geen
// afwijking aangetoond. Let op: bij 10 toetsen valt er bij eerlijke stenen ongeveer 1 op de 10 keer toch eentje
// toevallig door. Pas als dezelfde toets steeds opnieuw zakt, is er echt iets mis.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nl = (x, d = 0) => x.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Kansverdelingen ----------
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015; for (const k of c) s += k / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
// regularized upper incomplete gamma Q(a,x)
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; } return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
const chiP = (chi, df) => gammaQ(df / 2, chi / 2);
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const zP = (z) => 2 * (1 - Phi(Math.abs(z)));                    // tweezijdig
function ksP(D, n) { const l = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * D; let s = 0;
  for (let k = 1; k < 100; k++) { const t = 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * l * l); s += t; if (Math.abs(t) < 1e-12) break; } return Math.max(0, Math.min(1, s)); }
const chi2 = (obs, exp) => obs.reduce((a, o, i) => a + (o - exp[i]) ** 2 / exp[i], 0);

// ---------- Grafiekjes (SVG) ----------
// staafjes = gemeten, streepjes = verwacht. Eén reeks, dus geen legenda nodig; de titel zegt wat het is.
function bars(labels, obs, exp, { h = 160, fmt = (v) => nl(v), zoom = false } = {}) {
  const W = 560, padL = 54, padB = 22, padT = 8, n = labels.length, bw = (W - padL) / n;
  const hi = Math.max(...obs, ...exp), lo = zoom ? Math.min(...obs, ...exp) : 0;
  const span = (hi - lo) || 1, min = zoom ? lo - span * 0.6 : 0, max = hi + span * (zoom ? 0.3 : 0.06);
  const Y = (v) => padT + (h - padT - padB) * (1 - (v - min) / (max - min));
  const ticks = [min, (min + max) / 2, max].map((t) => `<g><line x1="${padL}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${padL - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(Math.round(t))}</text></g>`).join("");
  const g = labels.map((l, i) => {
    const x = padL + i * bw, w = Math.max(4, bw * 0.62), cx = x + bw / 2;
    return `<g class="b"><title>${esc(l)}: gemeten ${nl(obs[i])}, verwacht ${nl(Math.round(exp[i]))} (${obs[i] >= exp[i] ? "+" : ""}${nl((obs[i] / exp[i] - 1) * 100, 2)}%)</title>
      <rect class="hit" x="${x}" y="${padT}" width="${bw}" height="${h - padT - padB}"/>
      <path class="bar" d="M${cx - w / 2},${Y(min)} V${Y(obs[i]) + 3} q0,-3 3,-3 h${w - 6} q3,0 3,3 V${Y(min)} Z"/>
      <line class="exp" x1="${cx - w / 2 - 4}" x2="${cx + w / 2 + 4}" y1="${Y(exp[i])}" y2="${Y(exp[i])}"/>
      <text x="${cx}" y="${h - 6}" text-anchor="middle">${esc(l)}</text></g>`;
  }).join("");
  return `<svg class="tchart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Staafdiagram gemeten tegen verwacht">${ticks}${g}</svg>`;
}
function normalChart(vals, mu, sd) {
  const W = 560, h = 180, padL = 40, padB = 22, padT = 8, lo = mu - 4 * sd, hi = mu + 4 * sd, nb = 40, bw = (hi - lo) / nb;
  const cnt = new Array(nb).fill(0); for (const v of vals) { const k = Math.floor((v - lo) / bw); if (k >= 0 && k < nb) cnt[k]++; }
  const dens = (x) => vals.length * bw * Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
  const max = Math.max(...cnt, dens(mu)) * 1.08;
  const X = (x) => padL + (W - padL) * (x - lo) / (hi - lo), Y = (v) => padT + (h - padT - padB) * (1 - v / max);
  const rects = cnt.map((c, k) => `<g class="b"><title>${nl(lo + k * bw, 2)}–${nl(lo + (k + 1) * bw, 2)}: ${nl(c)} blokken, normaal verwacht ${nl(Math.round(dens(lo + (k + 0.5) * bw)))}</title>
    <rect class="bar" x="${X(lo + k * bw) + 1}" y="${Y(c)}" width="${Math.max(1, X(lo + bw) - X(lo) - 2)}" height="${Y(0) - Y(c)}" rx="2"/></g>`).join("");
  const pts = Array.from({ length: 121 }, (_, i) => { const x = lo + (hi - lo) * i / 120; return `${X(x).toFixed(1)},${Y(dens(x)).toFixed(1)}`; }).join(" ");
  const ax = [-3, -2, -1, 0, 1, 2, 3].map((k) => `<text x="${X(mu + k * sd)}" y="${h - 6}" text-anchor="middle">${nl(mu + k * sd, 2)}</text>`).join("");
  return `<svg class="tchart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Histogram van blokgemiddelden met normaalcurve"><line class="grid" x1="${padL}" x2="${W}" y1="${Y(0)}" y2="${Y(0)}"/>${rects}<polyline class="curve" points="${pts}"/>${ax}</svg>`;
}

// ---------- De test ----------
export async function runTest(N, die, progress) {
  const A = new Uint8Array(N), B = new Uint8Array(N), CH = 50000;
  for (let i = 0; i < N; i += CH) {
    const e = Math.min(N, i + CH);
    for (let k = i; k < e; k++) { A[k] = die(); B[k] = die(); }
    progress(e / N);
    await new Promise((r) => setTimeout(r, 0));
  }
  const T = [];   // {naam, uitleg, stat, p}
  const out = [];

  // 1. per kant (beide stenen samen, 2N waarden)
  const face = new Array(6).fill(0), fa = new Array(6).fill(0), fb = new Array(6).fill(0);
  for (let k = 0; k < N; k++) { fa[A[k] - 1]++; fb[B[k] - 1]++; }
  for (let i = 0; i < 6; i++) face[i] = fa[i] + fb[i];
  const eF = new Array(6).fill((2 * N) / 6);
  const cF = chi2(face, eF);
  T.push({ n: "Elke kant even vaak", d: "χ² op 2 miljoen stenen, 5 vrijheidsgraden", s: `χ² = ${nl(cF, 2)}`, p: chiP(cF, 5) });
  const cA = chi2(fa, eF.map((x) => x / 2)), cB = chi2(fb, eF.map((x) => x / 2));
  T.push({ n: "Steen 1 apart", d: "χ², 5 vrijheidsgraden", s: `χ² = ${nl(cA, 2)}`, p: chiP(cA, 5) });
  T.push({ n: "Steen 2 apart", d: "χ², 5 vrijheidsgraden", s: `χ² = ${nl(cB, 2)}`, p: chiP(cB, 5) });

  // 2. alle 36 combinaties (steen 1, steen 2): test ook samenhang tussen de stenen
  const pair = new Array(36).fill(0); for (let k = 0; k < N; k++) pair[(A[k] - 1) * 6 + B[k] - 1]++;
  const cP = chi2(pair, new Array(36).fill(N / 36));
  T.push({ n: "Alle 36 combinaties", d: "χ², 35 vrijheidsgraden", s: `χ² = ${nl(cP, 2)}`, p: chiP(cP, 35) });

  // 3. som 2..12
  const sum = new Array(11).fill(0); for (let k = 0; k < N; k++) sum[A[k] + B[k] - 2]++;
  const eS = sum.map((_, i) => (N * (6 - Math.abs(i + 2 - 7))) / 36);
  const cS = chi2(sum, eS);
  T.push({ n: "Som van de twee stenen", d: "χ², 10 vrijheidsgraden", s: `χ² = ${nl(cS, 2)}`, p: chiP(cS, 10) });

  // 4. mexen-uitkomsten (21 soorten worpen)
  const keys = [], eM = [], mIdx = {};
  for (let hi = 1; hi <= 6; hi++) for (let lo = 1; lo <= hi; lo++) { mIdx[hi * 10 + lo] = keys.length; keys.push([hi, lo]); eM.push(N * (hi === lo ? 1 : 2) / 36); }
  const mc = new Array(keys.length).fill(0);
  for (let k = 0; k < N; k++) { const hi = Math.max(A[k], B[k]), lo = Math.min(A[k], B[k]); mc[mIdx[hi * 10 + lo]]++; }
  const cM = chi2(mc, eM);
  T.push({ n: "Mexen-worpen (21 soorten)", d: "χ², 20 vrijheidsgraden", s: `χ² = ${nl(cM, 2)}`, p: chiP(cM, 20) });

  // 5. onafhankelijk: correlatie tussen steen 1 en 2, en tussen een worp en de volgende
  let sAB = 0, sAA1 = 0, mA = 0, mB = 0;
  for (let k = 0; k < N; k++) { mA += A[k]; mB += B[k]; }
  mA /= N; mB /= N;
  for (let k = 0; k < N; k++) { sAB += (A[k] - 3.5) * (B[k] - 3.5); if (k) sAA1 += (A[k] - 3.5) * (A[k - 1] - 3.5); }
  const varD = 35 / 12, rAB = sAB / N / varD, rLag = sAA1 / (N - 1) / varD;
  T.push({ n: "Stenen onafhankelijk van elkaar", d: "correlatie steen 1 en 2", s: `r = ${nl(rAB, 5)}`, p: zP(rAB * Math.sqrt(N)) });
  T.push({ n: "Worp onafhankelijk van de vorige", d: "correlatie met de vorige worp (lag 1)", s: `r = ${nl(rLag, 5)}`, p: zP(rLag * Math.sqrt(N - 1)) });

  // 6. gemiddelde ogen
  const mean = (mA + mB) / 2, zM = (mean - 3.5) / Math.sqrt(varD / (2 * N));
  T.push({ n: "Gemiddeld 3,5 ogen", d: `gemeten ${nl(mean, 5)}`, s: `z = ${nl(zM, 2)}`, p: zP(zM) });

  // 7. normaalverdeling: gemiddelde som per blok van 100 worpen (centrale limietstelling)
  const BL = 100, nb = Math.floor(N / BL), bm = new Float64Array(nb);
  for (let b = 0; b < nb; b++) { let s = 0; for (let k = b * BL; k < (b + 1) * BL; k++) s += A[k] + B[k]; bm[b] = s / BL; }
  const mu = 7, sd = Math.sqrt(35 / 6 / BL);
  const sorted = Float64Array.from(bm).sort();
  let D = 0;
  for (let i = 0; i < nb; ) { let j = i; while (j < nb && sorted[j] === sorted[i]) j++;
    const v = sorted[i], F = Phi((v + 0.005 - mu) / sd), Fl = Phi((v - 0.005 - mu) / sd);
    D = Math.max(D, Math.abs(j / nb - F), Math.abs(i / nb - Fl)); i = j; }
  let m2 = 0, m3 = 0, m4 = 0, bmean = 0; for (const v of bm) bmean += v; bmean /= nb;
  for (const v of bm) { const d = v - bmean; m2 += d * d; m3 += d ** 3; m4 += d ** 4; }
  m2 /= nb; m3 /= nb; m4 /= nb;
  const skew = m3 / m2 ** 1.5, kurt = m4 / m2 ** 2 - 3, bsd = Math.sqrt(m2);
  T.push({ n: "Blokgemiddelden normaal verdeeld", d: `Kolmogorov-Smirnov, ${nl(nb)} blokken van ${BL} worpen`, s: `D = ${nl(D, 4)}`, p: ksP(D, nb) });

  // ---------- uitslag ----------
  const bad = T.filter((t) => t.p < 0.01).length;
  const verdict = bad === 0 ? `<div class="verdict ok">✅ Alle ${T.length} toetsen geslaagd: geen afwijking van eerlijke stenen gevonden (99%).</div>`
    : `<div class="verdict warn">⚠️ ${bad} van ${T.length} toetsen onder p = 0,01. Bij eerlijke stenen gebeurt dat af en toe door toeval; draai de test opnieuw. Zakt dezelfde toets steeds, dan is er iets mis.</div>`;
  out.push(verdict);
  out.push(`<table class="stats ttable"><thead><tr><th>Toets</th><th>Uitkomst</th><th>p-waarde</th><th></th></tr></thead><tbody>${
    T.map((t) => `<tr><th scope="row">${esc(t.n)}<small>${esc(t.d)}</small></th><td>${t.s}</td><td>${t.p < 0.0001 ? "< 0,0001" : nl(t.p, 4)}</td><td>${t.p >= 0.01 ? '<span class="ok">✓ ok</span>' : '<span class="no">✗ afwijking</span>'}</td></tr>`).join("")}</tbody></table>`);
  out.push(`<p class="tag">p-waarde: de kans op minstens zo'n grote afwijking als de stenen eerlijk zijn. Boven 0,01 = past bij eerlijk op 99%-niveau.</p>`);

  out.push(`<h3>Elke kant (2 miljoen stenen)</h3><p class="tag">Ingezoomd zodat kleine verschillen zichtbaar zijn. Streepje = verwacht (${nl(Math.round(eF[0]))}).</p>`);
  out.push(bars(["1", "2", "3", "4", "5", "6"], face, eF, { zoom: true }));
  out.push(`<table class="stats ttable small"><thead><tr><th>Kant</th>${face.map((_, i) => `<th>${i + 1}</th>`).join("")}</tr></thead><tbody><tr><th>Aantal</th>${face.map((f) => `<td>${nl(f)}</td>`).join("")}</tr><tr><th>Afwijking</th>${face.map((f, i) => `<td>${f >= eF[i] ? "+" : ""}${nl((f / eF[i] - 1) * 100, 2)}%</td>`).join("")}</tr></tbody></table>`);

  out.push(`<h3>Som van de twee stenen</h3><p class="tag">De som is een driehoek (7 het vaakst), geen normaalverdeling. Streepje = verwacht.</p>`);
  out.push(bars(["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"], sum, eS));

  out.push(`<h3>Normaalverdeling</h3><p class="tag">Gemiddelde som per blok van ${BL} worpen. Volgens de centrale limietstelling hoort dat normaal verdeeld te zijn rond 7 met σ = ${nl(sd, 3)}. Lijn = normaalcurve.</p>`);
  out.push(normalChart(bm, mu, sd));
  out.push(`<p class="tag">Gemeten: gemiddelde ${nl(bmean, 4)}, σ ${nl(bsd, 4)} (verwacht ${nl(sd, 4)}), scheefheid ${nl(skew, 3)} (verwacht 0), kurtosis ${nl(kurt, 3)} (verwacht ≈ 0).</p>`);

  const named = (hi, lo) => (hi === 2 && lo === 1 ? "Mex" : hi === lo ? `${hi * 100}` : `${hi}${lo}`);
  const ord = keys.map((k, i) => i).sort((a, b) => { const v = ([h, l]) => (h === 2 && l === 1 ? 1000 : h === l ? h * 100 : h * 10 + l); return v(keys[b]) - v(keys[a]); });
  out.push(`<h3>Mexen-worpen</h3><div class="scroll"><table class="stats ttable small"><thead><tr><th>Worp</th><th>Verwacht</th><th>Gemeten</th><th>Aantal</th></tr></thead><tbody>${
    ord.map((i) => `<tr><th>${named(...keys[i])}</th><td>${nl((eM[i] / N) * 100, 3)}%</td><td>${nl((mc[i] / N) * 100, 3)}%</td><td>${nl(mc[i])}</td></tr>`).join("")}</tbody></table></div>`);
  out.push(`<p class="tag">Getest met dezelfde dobbelsteenfunctie als het spel: <code>crypto.getRandomValues</code>, bytes 252–255 weggegooid zodat elke kant exact 1/6 kans heeft.</p>`);
  return out.join("");
}
