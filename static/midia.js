// Mensagens de voz (player e gravador) e reuniões (Teams / Meet).
// Carregado antes de chat.js; usa as variáveis globais de chat.js (atual, respondendo...) só em tempo de execução.

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3z"/></svg>';
const ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
const NOME_PLAT = { teams: "Microsoft Teams", meet: "Google Meet" };
const BARRAS = 44;

function fmtTempo(seg) {
  seg = Math.max(0, Math.round(seg || 0));
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
}
function guardar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) {} }
function ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }

// =====================================================================
// PLAYER DE ÁUDIO
// =====================================================================
function barrasAudio(picos, semente) {
  let p = Array.isArray(picos) && picos.length ? picos : null;
  if (!p) { // arquivo de áudio comum: ondas "decorativas" estáveis
    let x = semente || 7; p = [];
    for (let i = 0; i < BARRAS; i++) { x = (x * 9301 + 49297) % 233280; p.push(0.25 + 0.6 * (x / 233280)); }
  }
  const out = [];
  for (let i = 0; i < BARRAS; i++) out.push(p[Math.floor(i * p.length / BARRAS)] || 0);
  return out.map(v => `<i style="height:${Math.round(18 + Math.max(0.06, v) * 82)}%"></i>`).join("");
}
function htmlPlayer({ src, duracao, picos, semente, local }) {
  return `<div class="audio-player" data-src="${esc(src)}" data-dur="${duracao || 0}"${local ? ' data-local="1"' : ""}>
    <button class="ap-play" type="button" title="Ouvir">${ICON_PLAY}</button>
    <div class="ap-onda" title="Clique para avançar">${barrasAudio(picos, semente)}</div>
    <span class="ap-tempo">${duracao ? fmtTempo(duracao) : "0:00"}</span>
    <button class="ap-vel" type="button" title="Velocidade">1x</button>
  </div>`;
}
function htmlAudio(m) {
  const meta = m.meta || {};
  return `<div class="voz">${htmlPlayer({ src: m.arquivo_url + "?ver=1", duracao: meta.duracao, picos: meta.picos })}</div>`;
}

const Player = (() => {
  let tocando = null; // { el, audio }
  const audios = new WeakMap();
  function durEl(el, audio) {
    const d = audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    return d || +el.dataset.dur || 0;
  }
  function pintar(el, audio) {
    const dur = durEl(el, audio), t = audio.currentTime || 0;
    const frac = dur ? Math.min(1, t / dur) : 0;
    const barras = el.querySelectorAll(".ap-onda i"), n = Math.round(frac * barras.length);
    barras.forEach((b, i) => b.classList.toggle("on", i < n));
    el.querySelector(".ap-tempo").textContent = (!audio.paused || t > 0) ? fmtTempo(t) : fmtTempo(dur);
  }
  function obter(el) {
    let a = audios.get(el);
    if (a) return a;
    a = new Audio(el.dataset.src);
    a.preload = "metadata";
    a.addEventListener("timeupdate", () => pintar(el, a));
    a.addEventListener("loadedmetadata", () => { if (!+el.dataset.dur && isFinite(a.duration)) { el.dataset.dur = a.duration; pintar(el, a); } });
    a.addEventListener("ended", () => { el.classList.remove("tocando"); el.querySelector(".ap-play").innerHTML = ICON_PLAY; a.currentTime = 0; pintar(el, a); el.querySelector(".ap-tempo").textContent = fmtTempo(durEl(el, a)); });
    a.addEventListener("error", () => { toast("Áudio indisponível", "Não foi possível reproduzir este áudio."); parar(); });
    audios.set(el, a);
    return a;
  }
  function parar() {
    if (!tocando) return;
    tocando.audio.pause();
    tocando.el.classList.remove("tocando");
    tocando.el.querySelector(".ap-play").innerHTML = ICON_PLAY;
    tocando = null;
  }
  function alternar(el) {
    const a = obter(el);
    if (tocando && tocando.el === el && !a.paused) { parar(); return; }
    parar();
    a.playbackRate = parseFloat(el.querySelector(".ap-vel").textContent) || 1;
    a.play().then(() => {
      tocando = { el, audio: a };
      el.classList.add("tocando");
      el.querySelector(".ap-play").innerHTML = ICON_PAUSE;
    }).catch(() => toast("Áudio indisponível", "O navegador não conseguiu tocar este áudio."));
  }
  function buscar(el, frac) {
    const a = obter(el), dur = durEl(el, a);
    if (!dur) return;
    a.currentTime = Math.max(0, Math.min(dur - 0.05, frac * dur));
    pintar(el, a);
  }
  document.addEventListener("click", e => {
    const el = e.target.closest(".audio-player");
    if (!el) return;
    e.stopPropagation();
    if (e.target.closest(".ap-play")) alternar(el);
    else if (e.target.closest(".ap-vel")) {
      const b = e.target.closest(".ap-vel");
      const prox = { "1x": "1.5x", "1.5x": "2x", "2x": "1x" }[b.textContent] || "1x";
      b.textContent = prox;
      const a = audios.get(el); if (a) a.playbackRate = parseFloat(prox);
    } else if (e.target.closest(".ap-onda")) {
      const r = e.target.closest(".ap-onda").getBoundingClientRect();
      buscar(el, (e.clientX - r.left) / r.width);
      if (!tocando || tocando.el !== el) alternar(el);
    }
  });
  return { parar };
})();

// =====================================================================
// GRAVADOR DE MENSAGEM DE VOZ
// =====================================================================
const Gravador = (() => {
  const MAX_SEG = 300; // 5 minutos
  let rec = null, stream = null, ctx = null, analisador = null, timer = null, inicio = 0, pedaços = [];
  let amostras = [], estado = "parado", blobFinal = null, duracaoFinal = 0, enviarAoParar = false, urlPrevia = null;
  const caixa = () => $("#caixa"), canvas = $("#gravOnda");

  function formatoSuportado() {
    const opcoes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    return opcoes.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  }
  function explicarSemMicrofone() {
    const seguro = window.isSecureContext;
    const motivo = seguro
      ? "Este navegador não permite gravar áudio. Use o Chrome, Edge ou Firefox atualizados."
      : `Para gravar áudio, abra o chat pelo endereço https:// (ex.: https://${location.hostname}:${location.port || 5080}). O navegador só libera o microfone em conexões seguras.`;
    toast("Microfone indisponível", motivo + " Enquanto isso, você pode enviar um arquivo de áudio.", () => $("#arquivoAudio").click());
  }
  function mostrarBarra(modo) {
    caixa().classList.add("gravando");
    caixa().classList.toggle("previa", modo === "previa");
    canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    canvas.height = 36 * (window.devicePixelRatio || 1);
  }
  function esconderBarra() {
    caixa().classList.remove("gravando", "previa");
    $("#gravPrevia").innerHTML = "";
    $("#gravTempo").textContent = "0:00";
  }
  function desenharOnda() {
    const g = canvas.getContext("2d"), w = canvas.width, h = canvas.height, dpr = window.devicePixelRatio || 1;
    g.clearRect(0, 0, w, h);
    const larg = 3 * dpr, esp = 2 * dpr, cabe = Math.floor(w / (larg + esp));
    const ult = amostras.slice(-cabe);
    // escala automática: a voz ocupa a altura da barra, seja ela baixa ou alta
    const ref = Math.max(0.04, ...amostras.slice(-120));
    g.fillStyle = "#FC4900";
    ult.forEach((v, i) => {
      const bh = Math.max(3 * dpr, Math.min(1, v / ref) * (h - 4 * dpr));
      const x = w - (ult.length - i) * (larg + esp);
      g.beginPath();
      if (g.roundRect) g.roundRect(x, (h - bh) / 2, larg, bh, larg / 2); else g.rect(x, (h - bh) / 2, larg, bh);
      g.fill();
    });
  }
  function amostrar() {
    const dados = new Uint8Array(analisador.fftSize);
    analisador.getByteTimeDomainData(dados);
    let soma = 0;
    for (const v of dados) { const x = (v - 128) / 128; soma += x * x; }
    amostras.push(Math.sqrt(soma / dados.length));
    const seg = (performance.now() - inicio) / 1000;
    $("#gravTempo").textContent = fmtTempo(seg);
    desenharOnda();
    if (seg >= MAX_SEG) { toast("Limite de 5 minutos", "A gravação foi encerrada. Ouça e envie."); parar(false); }
  }
  function picos() {
    if (!amostras.length) return [];
    const n = 48, out = [];
    for (let i = 0; i < n; i++) {
      const fatia = amostras.slice(Math.floor(i * amostras.length / n), Math.max(Math.floor((i + 1) * amostras.length / n), Math.floor(i * amostras.length / n) + 1));
      out.push(Math.max(...fatia));
    }
    const max = Math.max(...out) || 1;
    return out.map(v => +(Math.max(0.06, v / max)).toFixed(2));
  }
  function liberar() {
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (ctx) ctx.close().catch(() => {});
    ctx = null; analisador = null;
  }

  async function iniciar() {
    if (!atual || estado !== "parado") return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { explicarSemMicrofone(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const msg = e.name === "NotAllowedError"
        ? "O acesso ao microfone foi bloqueado. Clique no cadeado ao lado do endereço e permita o microfone."
        : e.name === "NotFoundError" ? "Nenhum microfone foi encontrado neste computador." : "Não foi possível acessar o microfone.";
      toast("Microfone", msg);
      return;
    }
    const tipo = formatoSuportado();
    try { rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 48000 } : undefined); }
    catch (e) { rec = new MediaRecorder(stream); }
    pedaços = []; amostras = []; blobFinal = null; enviarAoParar = false;
    rec.ondataavailable = e => { if (e.data && e.data.size) pedaços.push(e.data); };
    rec.onstop = aoParar;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analisador = ctx.createAnalyser(); analisador.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analisador);
    rec.start(250);
    inicio = performance.now();
    estado = "gravando";
    mostrarBarra("gravando");
    timer = setInterval(amostrar, 90);
    Player.parar();
  }
  function parar(enviar) {
    if (estado !== "gravando") return;
    enviarAoParar = !!enviar;
    duracaoFinal = (performance.now() - inicio) / 1000;
    estado = "finalizando";
    clearInterval(timer); timer = null;
    rec.stop();
  }
  function aoParar() {
    liberar();
    blobFinal = new Blob(pedaços, { type: (rec.mimeType || "audio/webm") });
    if (duracaoFinal < 0.8 || blobFinal.size < 500) { toast("Gravação muito curta", "Segure um pouco mais para gravar a mensagem."); descartar(); return; }
    if (enviarAoParar) { enviarBlob(); return; }
    estado = "previa";
    if (urlPrevia) URL.revokeObjectURL(urlPrevia);
    urlPrevia = URL.createObjectURL(blobFinal);
    $("#gravPrevia").innerHTML = htmlPlayer({ src: urlPrevia, duracao: duracaoFinal, picos: picos(), local: true });
    $("#gravTempo").textContent = fmtTempo(duracaoFinal);
    mostrarBarra("previa");
  }
  async function enviarBlob() {
    if (!blobFinal || !atual) { descartar(); return; }
    const conv = atual.id;
    const tipo = (blobFinal.type || "audio/webm").split(";")[0];
    const ext = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" }[tipo] || "webm";
    const fd = new FormData();
    fd.append("audio", blobFinal, `voz.${ext}`);
    fd.append("duracao", duracaoFinal.toFixed(1));
    fd.append("picos", JSON.stringify(picos()));
    if (respondendo) fd.append("responde_a", respondendo);
    estado = "enviando";
    $("#gravEnviar").disabled = true;
    try {
      await api(`/api/conversas/${conv}/audio`, { method: "POST", body: fd });
      window.cancelarResposta && cancelarResposta();
      descartar();
    } catch (e) {
      toast("Falha ao enviar o áudio", e.message);
      estado = "previa";
    }
    $("#gravEnviar").disabled = false;
  }
  function descartar() {
    if (estado === "gravando") { enviarAoParar = false; estado = "descartando"; rec.onstop = () => liberar(); rec.stop(); }
    liberar();
    Player.parar();
    if (urlPrevia) { URL.revokeObjectURL(urlPrevia); urlPrevia = null; }
    blobFinal = null; pedaços = []; amostras = [];
    estado = "parado";
    esconderBarra();
  }

  $("#btnMic").onclick = iniciar;
  $("#gravParar").onclick = () => parar(false);
  $("#gravDescartar").onclick = descartar;
  $("#gravEnviar").onclick = () => { if (estado === "gravando") parar(true); else if (estado === "previa") enviarBlob(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && estado !== "parado" && estado !== "enviando") descartar(); });
  // arquivo de áudio pronto (alternativa quando não há microfone)
  $("#arquivoAudio").onchange = e => { const f = e.target.files[0]; if (f && window.definirAnexo) definirAnexo(f); e.target.value = ""; };
  return { iniciar, descartar, ativo: () => estado !== "parado" };
})();

// =====================================================================
// REUNIÕES (Teams / Meet)
// =====================================================================
const PADRAO_LINK = {
  teams: /^https:\/\/(teams\.microsoft\.com|teams\.live\.com|[a-z0-9-]+\.teams\.microsoft\.com)\/\S+$/i,
  meet: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?\S*)?$/i,
};
function plataformaDoLink(link) {
  for (const p in PADRAO_LINK) if (PADRAO_LINK[p].test((link || "").trim())) return p;
  return null;
}
const pDataISO = s => new Date(s.length === 16 ? s + ":00" : s);
function fmtQuando(meta) {
  const ini = pDataISO(meta.inicio), fim = pDataISO(meta.fim);
  const hoje = new Date(), amanha = new Date(Date.now() + 864e5);
  const h = d => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  let dia = ini.toDateString() === hoje.toDateString() ? "Hoje" : ini.toDateString() === amanha.toDateString() ? "Amanhã"
    : ini.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return `${dia}, ${h(ini)} – ${h(fim)}`;
}
function statusReuniao(meta) {
  const agora = Date.now(), ini = pDataISO(meta.inicio).getTime(), fim = pDataISO(meta.fim).getTime();
  if (agora >= fim) return { cls: "encerrada", txt: "Encerrada" };
  if (agora >= ini) return { cls: "agora", txt: "Em andamento" };
  const min = Math.round((ini - agora) / 60000);
  if (min <= 60) return { cls: "breve", txt: min <= 1 ? "Começa em 1 min" : `Começa em ${min} min` };
  return { cls: "futura", txt: "" };
}
function htmlReuniao(m) {
  const r = m.meta || {}, st = statusReuniao(r);
  return `<div class="reuniao-card ${st.cls}" data-reuniao="${m.id}">
    <div class="rc-topo"><span class="pl-icone ${r.plataforma}">${ICON_VIDEO}</span>
      <div><small>${NOME_PLAT[r.plataforma] || "Reunião"}</small><b>${esc(r.titulo || m.texto)}</b></div></div>
    <div class="rc-quando">${ICON_CAL}<span>${fmtQuando(r)}</span><em class="rc-status">${st.txt}</em></div>
    ${r.pauta ? `<div class="rc-pauta">${linkify(r.pauta)}</div>` : ""}
    <div class="rc-acoes">
      <a class="btn ${st.cls === "encerrada" ? "sec" : "prim"}" href="${esc(r.link)}" target="_blank" rel="noopener">${ICON_VIDEO}Entrar na reunião</a>
      <button class="btn sec" type="button" data-copiar-link="${esc(r.link)}">Copiar link</button>
      <button class="btn sec rc-ics" type="button" data-ics="${m.id}" title="Baixar convite para a agenda (Outlook, Google Agenda)">${ICON_CAL}</button>
    </div>
  </div>`;
}
// link de reunião colado numa mensagem comum vira um atalho para entrar
function htmlLinkReuniao(texto) {
  const achados = (texto || "").match(/https:\/\/[^\s<]+/g) || [];
  const link = achados.find(l => plataformaDoLink(l));
  if (!link) return "";
  const p = plataformaDoLink(link);
  return `<a class="link-reuniao" href="${esc(link)}" target="_blank" rel="noopener"><span class="pl-icone ${p}">${ICON_VIDEO}</span>
    <span><small>Link de reunião</small><b>Entrar no ${NOME_PLAT[p]}</b></span></a>`;
}
function atualizarCartoes() {
  $$(".reuniao-card").forEach(card => {
    const m = cacheMsg[+card.dataset.reuniao];
    if (!m || !m.meta) return;
    const st = statusReuniao(m.meta);
    card.className = `reuniao-card ${st.cls}`;
    card.querySelector(".rc-status").textContent = st.txt;
    const entrar = card.querySelector(".rc-acoes a");
    entrar.classList.toggle("prim", st.cls !== "encerrada"); entrar.classList.toggle("sec", st.cls === "encerrada");
  });
}
function baixarICS(m) {
  const r = m.meta, f = s => s.replace(/[-:]/g, "") + "00";
  const escICS = t => String(t || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, c => "\\" + c);
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Valorizacao Chat//PT-BR", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:reuniao-${m.id}@valorizacao-chat`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART:${f(r.inicio)}`, `DTEND:${f(r.fim)}`, `SUMMARY:${escICS(r.titulo)}`,
    `DESCRIPTION:${escICS((r.pauta ? r.pauta + "\n\n" : "") + "Entrar: " + r.link)}`, `LOCATION:${escICS(r.link)}`, `URL:${r.link}`,
    "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "DESCRIPTION:Lembrete", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = (r.titulo || "reuniao").replace(/[^\wÀ-ú -]/g, "").slice(0, 60) + ".ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-copiar-link]");
  if (c) { e.stopPropagation(); navigator.clipboard?.writeText(c.dataset.copiarLink).then(() => toast("Link copiado", "Cole onde quiser para compartilhar a reunião.")); }
  const i = e.target.closest("[data-ics]");
  if (i) { e.stopPropagation(); const m = cacheMsg[+i.dataset.ics] || Reunioes.porId(+i.dataset.ics); if (m) baixarICS(m); }
});

const Reunioes = (() => {
  let lista = [], plataforma = ler("reuniao.plataforma") || "teams", quando = "agora";
  const avisadas = new Set(JSON.parse((() => { try { return sessionStorage.getItem("reunioes.avisadas"); } catch (e) { return null; } })() || "[]"));
  const pad = n => String(n).padStart(2, "0");
  const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function offset(d) { const o = -d.getTimezoneOffset(), s = o >= 0 ? "+" : "-"; return `${s}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`; }

  // ---------- janela "Marcar reunião" ----------
  function inicioEscolhido() {
    if (quando === "agora") { const d = new Date(); d.setSeconds(0, 0); return d; }
    const d = $("#reuData").value, h = $("#reuHora").value;
    return d && h ? new Date(`${d}T${h}:00`) : null;
  }
  function linkGerador() {
    const ini = inicioEscolhido() || new Date(), fim = new Date(ini.getTime() + (+$("#reuDuracao").value || 30) * 60000);
    const titulo = $("#reuTitulo").value.trim() || "Reunião", pauta = $("#reuPauta").value.trim();
    if (plataforma === "teams") {
      const iso = d => `${isoLocal(d)}:00${offset(d)}`;
      return `https://teams.microsoft.com/l/meeting/new?subject=${encodeURIComponent(titulo)}&startTime=${encodeURIComponent(iso(ini))}&endTime=${encodeURIComponent(iso(fim))}` + (pauta ? `&content=${encodeURIComponent(pauta)}` : "");
    }
    if (quando === "agora") return "https://meet.google.com/new";
    const g = d => isoLocal(d).replace(/[-:]/g, "") + "00";
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titulo)}&dates=${g(ini)}/${g(fim)}&details=${encodeURIComponent(pauta)}&ctz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo")}`;
  }
  function atualizarModal() {
    $$(".plataforma").forEach(b => { const on = b.dataset.plat === plataforma; b.classList.toggle("ativo", on); b.setAttribute("aria-checked", on); });
    $$(".segmento [data-quando]").forEach(b => b.classList.toggle("ativo", b.dataset.quando === quando));
    $("#linhaAgenda").style.display = quando === "agendar" ? "" : "none";
    if (plataforma === "teams") {
      $("#reuGerar").innerHTML = `${ICON_VIDEO} Abrir o Teams para criar a reunião ↗`;
      $("#reuDica").textContent = "O Teams abre com assunto e horário preenchidos. Salve, abra a reunião e copie o link “Ingressar”.";
    } else if (quando === "agora") {
      $("#reuGerar").innerHTML = `${ICON_VIDEO} Criar sala no Google Meet ↗`;
      $("#reuDica").textContent = "Abre uma sala nova. Copie o endereço que aparece (meet.google.com/xxx-xxxx-xxx).";
    } else {
      $("#reuGerar").innerHTML = `${ICON_CAL} Criar no Google Agenda com Meet ↗`;
      $("#reuDica").textContent = "Abre o Google Agenda já preenchido. Clique em “Adicionar videoconferência do Google Meet”, salve e copie o link.";
    }
    const salvo = ler("reuniao.sala." + plataforma);
    const campo = $("#reuLink");
    if (!campo.value.trim() || (plataformaDoLink(campo.value) && plataformaDoLink(campo.value) !== plataforma && campo.dataset.auto === "1")) {
      campo.value = salvo || ""; campo.dataset.auto = salvo ? "1" : "";
    }
    $("#reuLembrar").checked = !!salvo && campo.value === salvo;
    validarLink();
  }
  function validarLink() {
    const v = $("#reuLink").value.trim(), p = plataformaDoLink(v), ok = $("#reuLinkOk");
    ok.className = v ? (p ? "ok" : "erro") : "";
    ok.title = v ? (p ? `Link do ${NOME_PLAT[p]}` : "Link não reconhecido") : "";
    if (p && p !== plataforma) { plataforma = p; atualizarModal(); }
    $("#reuEnviar").disabled = !p;
  }
  function abrirModalReuniao() {
    if (!atual) return;
    $("#erroReuniao").textContent = "";
    $("#reuTitulo").value = `Reunião — ${atual.nome}`;
    $("#reuPauta").value = "";
    $("#reuLink").value = ""; $("#reuLink").dataset.auto = "";
    const prox = new Date(); prox.setMinutes(prox.getMinutes() < 30 ? 30 : 60, 0, 0);
    $("#reuData").value = isoLocal(prox).slice(0, 10); $("#reuData").min = isoLocal(new Date()).slice(0, 10);
    $("#reuHora").value = isoLocal(prox).slice(11);
    quando = "agora";
    atualizarModal();
    abrirModal("modalReuniao");
  }
  $$(".plataforma").forEach(b => b.onclick = () => { plataforma = b.dataset.plat; guardar("reuniao.plataforma", plataforma); $("#reuLink").value = ""; atualizarModal(); });
  $$(".segmento [data-quando]").forEach(b => b.onclick = () => { quando = b.dataset.quando; atualizarModal(); });
  $("#reuLink").addEventListener("input", () => { $("#reuLink").dataset.auto = ""; validarLink(); });
  $("#reuGerar").onclick = () => window.open(linkGerador(), "_blank", "noopener");
  $("#reuEnviar").onclick = async () => {
    const link = $("#reuLink").value.trim();
    const corpo = { link, titulo: $("#reuTitulo").value.trim(), pauta: $("#reuPauta").value.trim(),
      agora: quando === "agora", duracao: +$("#reuDuracao").value || 30 };
    if (quando === "agendar") {
      const ini = inicioEscolhido();
      if (!ini) { $("#erroReuniao").textContent = "Informe a data e a hora."; return; }
      corpo.inicio = isoLocal(ini);
    }
    if ($("#reuLembrar").checked) guardar("reuniao.sala." + plataformaDoLink(link), link);
    else if (ler("reuniao.sala." + plataformaDoLink(link)) === link) { try { localStorage.removeItem("reuniao.sala." + plataformaDoLink(link)); } catch (e) {} }
    try {
      await api(`/api/conversas/${atual.id}/reuniao`, { method: "POST", body: corpo });
      fecharModal("modalReuniao");
      if (corpo.agora) window.open(link, "_blank", "noopener");
    } catch (e) { $("#erroReuniao").textContent = e.message; }
  };
  $("#btnReuniao").onclick = abrirModalReuniao;

  // ---------- painel "Reuniões" ----------
  async function carregar() {
    try { lista = await api("/api/reunioes"); } catch (e) { return; }
    atualizarBadge();
    if ($("#listaReunioes").style.display !== "none") render();
  }
  function atualizarBadge() {
    const hoje = new Date().toDateString();
    const n = lista.filter(m => { const st = statusReuniao(m.meta); return st.cls !== "encerrada" && pDataISO(m.meta.inicio).toDateString() === hoje; }).length;
    const b = $("#badgeReunioes");
    if (b) { b.style.display = n ? "" : "none"; b.textContent = n; }
  }
  function itemPainel(m) {
    const r = m.meta, st = statusReuniao(r), ini = pDataISO(r.inicio);
    const conv = (conversas.find(c => c.id === m.conversa_id) || {}).nome || "";
    return `<div class="reu-item ${st.cls}" data-conv="${m.conversa_id}" data-alvo="${m.id}">
      <div class="reu-dia"><b>${ini.getDate()}</b><small>${ini.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></div>
      <div class="reu-info"><b>${esc(r.titulo)}</b>
        <small>${fmtQuando(r).split(", ")[1]} · ${NOME_PLAT[r.plataforma]}${conv ? " · " + esc(conv) : ""}</small>
        ${st.txt ? `<em>${st.txt}</em>` : ""}</div>
      ${st.cls !== "encerrada" ? `<a class="btn ${st.cls === "futura" ? "sec" : "prim"} reu-entrar" href="${esc(r.link)}" target="_blank" rel="noopener">Entrar</a>` : ""}
    </div>`;
  }
  function render() {
    const grupos = { agora: [], hoje: [], proximas: [], encerradas: [] }, hoje = new Date().toDateString();
    lista.forEach(m => {
      const st = statusReuniao(m.meta);
      if (st.cls === "agora") grupos.agora.push(m);
      else if (st.cls === "encerrada") grupos.encerradas.push(m);
      else if (pDataISO(m.meta.inicio).toDateString() === hoje) grupos.hoje.push(m);
      else grupos.proximas.push(m);
    });
    grupos.encerradas.reverse();
    const sec = (t, arr) => arr.length ? `<div class="secao-titulo">${t}</div>${arr.map(itemPainel).join("")}` : "";
    const html = sec("Acontecendo agora", grupos.agora) + sec("Hoje", grupos.hoje) + sec("Próximas", grupos.proximas) + sec("Encerradas (últimos 7 dias)", grupos.encerradas);
    $("#listaReunioes").innerHTML = (html || `<div class="lista-vazia">Nenhuma reunião marcada.</div>`) +
      `<p class="reu-dica">${ICON_VIDEO}<span>Para marcar, abra uma conversa ou grupo e clique em <b>Reunião</b> no topo.</span></p>`;
  }
  $("#listaReunioes").addEventListener("click", e => {
    if (e.target.closest(".reu-entrar")) return;
    const it = e.target.closest(".reu-item");
    if (it) abrirConversa(+it.dataset.conv, +it.dataset.alvo);
  });
  function mostrarPainel(sim) {
    $("#listaReunioes").style.display = sim ? "" : "none";
    $("#listaConversas").style.display = sim ? "none" : "";
    $(".filtros").style.display = sim ? "none" : "";
    $(".lista-topo > div").style.visibility = sim ? "hidden" : "";
    if (sim) { $("#tituloLista").textContent = "Reuniões"; render(); carregar(); }
  }

  // ---------- lembrete 5 minutos antes ----------
  function verificarLembretes() {
    const agora = Date.now();
    lista.forEach(m => {
      const ini = pDataISO(m.meta.inicio).getTime(), falta = ini - agora;
      if (falta > 0 && falta <= 5 * 60000 && !avisadas.has(m.id) && !m.meta.agora) {
        avisadas.add(m.id);
        try { sessionStorage.setItem("reunioes.avisadas", JSON.stringify([...avisadas])); } catch (e) {}
        const min = Math.max(1, Math.round(falta / 60000));
        toast(`Reunião em ${min} min`, `${m.meta.titulo} · clique para entrar`, () => window.open(m.meta.link, "_blank", "noopener"));
        if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification(`Reunião em ${min} min`, { body: `${m.meta.titulo} (${NOME_PLAT[m.meta.plataforma]})`, icon: "/static/icone.png", tag: "reu" + m.id });
          n.onclick = () => { window.open(m.meta.link, "_blank", "noopener"); n.close(); };
        }
        window.tocarSom && tocarSom();
      }
    });
    atualizarCartoes();
    atualizarBadge();
    if ($("#listaReunioes").style.display !== "none") render();
  }
  setInterval(verificarLembretes, 20000);

  return {
    carregar, mostrarPainel, verificar: verificarLembretes,
    porId: id => lista.find(m => m.id === id),
    aoReceber: m => { if (m.tipo === "reuniao") carregar(); },
    aoAlterar: m => { if (lista.some(x => x.id === m.id)) carregar(); },
  };
})();
