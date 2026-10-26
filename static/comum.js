// Funções compartilhadas entre o chat e a administração
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function iniciais(nome) {
  const p = String(nome || "?").replace(/\(removido\)/, "").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function htmlFoto(foto) {
  return foto ? `<img src="${esc(foto)}" alt="" loading="lazy" onerror="this.remove()">` : "";
}
function avatar(u, extra = "") {
  const status = u.online !== undefined ? `<span class="status ${u.online ? "on" : ""}" data-status="${u.id}"></span>` : "";
  const dataU = u.id ? ` data-u="${u.id}"` : "";
  return `<span class="avatar ${extra}"${dataU} style="background:${u.cor || "#5F6368"}">${esc(iniciais(u.nome))}${htmlFoto(u.foto)}${status}</span>`;
}
// troca a foto de um usuário em todos os avatares já desenhados na tela
function aplicarFotoNaTela(uid, foto) {
  $$(`.avatar[data-u="${uid}"]`).forEach(el => {
    el.querySelector(":scope > img")?.remove();
    if (foto) el.insertAdjacentHTML("afterbegin", htmlFoto(foto));
  });
}
function desenharMeuAvatar() {
  $("#meuAvatar").innerHTML = avatar({ ...ME, online: undefined }) ;
  $("#meuAvatar .avatar").insertAdjacentHTML("beforeend", '<span class="status on" id="meuStatus"></span>');
  $("#meuAvatarMenu").innerHTML = avatar({ ...ME, online: undefined }, "g") + '<span class="lapis"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>';
}
desenharMeuAvatar();
function avatarGrupo(nome, extra = "g") {
  return `<span class="avatar grupo ${extra}" style="background:var(--grafite-2)">${esc(iniciais(nome))}</span>`;
}
async function api(url, opts = {}) {
  const o = { headers: {}, ...opts };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers["Content-Type"] = "application/json";
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(url, o);
  if (r.status === 401) { location.href = "/login"; throw new Error("sessão expirada"); }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || "Erro " + r.status);
  return dados;
}
function abrirModal(id) { $("#" + id).classList.add("ativo"); }
function fecharModal(id) { $("#" + id).classList.remove("ativo"); }
document.addEventListener("click", e => {
  const f = e.target.closest("[data-fechar]");
  if (f) f.closest(".modal-fundo").classList.remove("ativo");
  if (e.target.classList.contains("modal-fundo") && !(e.target.id === "modalSenha" && window.TROCAR_SENHA))
    e.target.classList.remove("ativo");
  if (!e.target.closest(".perfil-btn")) $("#menuPerfil")?.classList.remove("ativo");
});
function toast(titulo, texto, aoClicar) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<b>${esc(titulo)}</b>${esc(texto)}`;
  t.onclick = () => { aoClicar && aoClicar(); t.remove(); };
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// menu de perfil
$("#btnPerfil").onclick = () => $("#menuPerfil").classList.toggle("ativo");
$("#btnSenha").onclick = () => { $("#menuPerfil").classList.remove("ativo"); abrirModal("modalSenha"); };
$("#salvarSenha").onclick = async () => {
  const erro = $("#erroSenha");
  erro.textContent = "";
  if ($("#senhaNova").value !== $("#senhaConf").value) { erro.textContent = "As senhas não conferem."; return; }
  try {
    await api("/api/senha", { method: "POST", body: { atual: $("#senhaAtual").value, nova: $("#senhaNova").value } });
    window.TROCAR_SENHA = false;
    fecharModal("modalSenha");
    $$("#modalSenha input").forEach(i => i.value = "");
    toast("Senha alterada", "Sua nova senha já está valendo.");
  } catch (e) { erro.textContent = e.message; }
};
if (window.TROCAR_SENHA) abrirModal("modalSenha");

// conexão em tempo real
const socket = window.TEMPO_REAL ? io({ transports: ["websocket", "polling"] }) : modoConsulta();
socket.on("connect", () => $("#meuStatus")?.classList.add("on"));
socket.on("disconnect", () => $("#meuStatus")?.classList.remove("on"));
socket.on("forcar_saida", () => { location.href = "/logout"; });
socket.on("presenca", p => {
  $$(`[data-status="${p.user_id}"]`).forEach(s => s.classList.toggle("on", p.online));
  window.aoMudarPresenca && window.aoMudarPresenca(p);
});

// Sem WebSocket: imita o socket consultando o servidor a cada 3 s e enviando por HTTP.
function modoConsulta() {
  const ouvintes = {};
  const disparar = (ev, d) => (ouvintes[ev] || []).forEach(f => f(d));
  let desde = null, alt = "", nConversas = null, timer = null, rodando = false;
  async function consultar() {
    if (rodando) return;
    rodando = true;
    clearTimeout(timer);
    try {
      const q = desde === null ? "" : `?desde=${desde}&alt=${encodeURIComponent(alt)}`;
      const r = await api("/api/novidades" + q);
      if (nConversas !== null && r.conversas !== nConversas) disparar("conversa_nova", {});
      nConversas = r.conversas;
      if (desde !== null) {
        (r.novas || []).forEach(m => disparar("mensagem", m));
        (r.alteradas || []).forEach(m => disparar("mensagem_alterada", m));
      }
      desde = r.ultimo_id;
      alt = r.agora;
    } catch (e) { /* tenta de novo na próxima rodada */ }
    rodando = false;
    timer = setTimeout(consultar, document.visibilityState === "visible" ? 3000 : 10000);
  }
  setTimeout(consultar, 300);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") consultar(); });
  return {
    connected: false,
    on(ev, f) { (ouvintes[ev] = ouvintes[ev] || []).push(f); },
    emit(ev, dados, cb) {
      if (!["enviar", "editar", "apagar"].includes(ev)) return;
      api("/api/acao/" + ev, { method: "POST", body: dados })
        .then(r => { cb && cb(r); consultar(); })
        .catch(() => cb && cb({ ok: false }));
    },
  };
}

// ---------- foto de perfil (recorte circular com zoom e arrastar) ----------
const Foto = (() => {
  const V = 280;                       // tamanho da área de recorte em px
  let img = null, nat = { w: 0, h: 0 }, base = 1, zoom = 1, pos = { x: 0, y: 0 }, alvo = null;
  const el = $("#recorteImg"), z = $("#zoomFoto");
  const escala = () => base * zoom;
  function limitar() {
    const w = nat.w * escala(), h = nat.h * escala();
    pos.x = Math.min(0, Math.max(V - w, pos.x));
    pos.y = Math.min(0, Math.max(V - h, pos.y));
  }
  function desenhar() {
    limitar();
    el.style.width = nat.w * escala() + "px";
    el.style.height = nat.h * escala() + "px";
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }
  function estado(temImagem) {
    $("#recorte").classList.toggle("com-imagem", temImagem);
    $("#zoomLinha").style.visibility = temImagem ? "visible" : "hidden";
    $("#salvarFoto").disabled = !temImagem;
  }
  function carregar(arquivo) {
    $("#erroFoto").textContent = "";
    if (!arquivo || !/^image\/(jpeg|png|webp)$/.test(arquivo.type)) { $("#erroFoto").textContent = "Escolha uma imagem JPG, PNG ou WEBP."; return; }
    if (arquivo.size > 8 * 1024 * 1024) { $("#erroFoto").textContent = "A imagem passa de 8 MB."; return; }
    const url = URL.createObjectURL(arquivo);
    const i = new Image();
    i.onload = () => {
      img = i; nat = { w: i.naturalWidth, h: i.naturalHeight };
      base = V / Math.min(nat.w, nat.h); zoom = 1; z.value = 1;
      pos = { x: (V - nat.w * base) / 2, y: (V - nat.h * base) / 2 };
      el.src = url; desenhar(); estado(true);
    };
    i.onerror = () => { $("#erroFoto").textContent = "Não foi possível abrir essa imagem."; };
    i.src = url;
  }
  z.addEventListener("input", () => {
    if (!img) return;
    // mantém o centro do recorte no mesmo ponto da imagem ao dar zoom
    const cx = (V / 2 - pos.x) / escala(), cy = (V / 2 - pos.y) / escala();
    zoom = +z.value;
    pos = { x: V / 2 - cx * escala(), y: V / 2 - cy * escala() };
    desenhar();
  });
  let arrasto = null;
  $("#recorte").addEventListener("pointerdown", e => {
    if (!img) { $("#arquivoFoto").click(); return; }
    arrasto = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    $("#recorte").setPointerCapture(e.pointerId);
  });
  $("#recorte").addEventListener("pointermove", e => {
    if (!arrasto) return;
    pos = { x: e.clientX - arrasto.x, y: e.clientY - arrasto.y }; desenhar();
  });
  ["pointerup", "pointercancel"].forEach(t => $("#recorte").addEventListener(t, () => arrasto = null));
  $("#recorte").addEventListener("wheel", e => {
    if (!img) return;
    e.preventDefault();
    z.value = Math.min(4, Math.max(1, +z.value - e.deltaY * 0.0015));
    z.dispatchEvent(new Event("input"));
  }, { passive: false });
  $("#recorte").addEventListener("dragover", e => e.preventDefault());
  $("#recorte").addEventListener("drop", e => { e.preventDefault(); carregar(e.dataTransfer.files[0]); });
  $("#arquivoFoto").addEventListener("change", e => carregar(e.target.files[0]));

  function abrir(opcoes) {
    // opcoes: { usuario, urlEnvio, aoMudar }
    alvo = opcoes; img = null; el.removeAttribute("src");
    const u = opcoes.usuario;
    $("#fotoTitulo").textContent = u.id === ME.id ? "Sua foto de perfil" : `Foto de ${u.nome}`;
    $("#recorteVazio").innerHTML = avatar({ ...u, online: undefined }, "gigante") +
      '<span>Clique ou arraste uma imagem aqui</span>';
    $("#removerFoto").style.display = u.foto ? "" : "none";
    $("#erroFoto").textContent = ""; $("#arquivoFoto").value = "";
    estado(false);
    abrirModal("modalFoto");
  }
  $("#salvarFoto").onclick = () => {
    if (!img) return;
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const k = escala();
    c.getContext("2d").drawImage(img, -pos.x / k, -pos.y / k, V / k, V / k, 0, 0, 512, 512);
    $("#salvarFoto").disabled = true; $("#salvarFoto").textContent = "Salvando…";
    c.toBlob(async blob => {
      const fd = new FormData(); fd.append("foto", blob, "foto.jpg");
      try {
        const r = await api(alvo.urlEnvio, { method: "POST", body: fd });
        fecharModal("modalFoto");
        toast("Foto atualizada", alvo.usuario.id === ME.id ? "Todos já veem sua nova foto." : `Foto de ${alvo.usuario.nome} atualizada.`);
        alvo.aoMudar && alvo.aoMudar(r);
      } catch (e) { $("#erroFoto").textContent = e.message; }
      $("#salvarFoto").textContent = "Salvar foto"; $("#salvarFoto").disabled = !img;
    }, "image/jpeg", 0.9);
  };
  $("#removerFoto").onclick = async () => {
    if (!confirm("Remover a foto de perfil? Voltam a aparecer as iniciais.")) return;
    try {
      await api(alvo.urlEnvio, { method: "DELETE" });
      fecharModal("modalFoto");
      alvo.aoMudar && alvo.aoMudar(null);
    } catch (e) { $("#erroFoto").textContent = e.message; }
  };
  return { abrir };
})();

function abrirMinhaFoto() {
  $("#menuPerfil").classList.remove("ativo");
  Foto.abrir({ usuario: ME, urlEnvio: "/api/foto" });
}
$("#btnFoto").onclick = abrirMinhaFoto;
$("#meuAvatarMenu").onclick = abrirMinhaFoto;

// alguém trocou a foto: atualiza na hora em todas as telas abertas
socket.on("foto_alterada", d => {
  if (d.user_id === ME.id) { ME.foto = d.foto; desenharMeuAvatar(); }
  aplicarFotoNaTela(d.user_id, d.foto);
  window.aoMudarFoto && window.aoMudarFoto(d);
});
