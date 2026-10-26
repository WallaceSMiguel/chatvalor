// Tela principal do chat
let conversas = [];
let usuarios = [];
let atual = null;          // conversa aberta (objeto completo)
let maisAntigo = null;     // id da mensagem mais antiga carregada
let filtro = "todas";
let anexo = null;
let modoModal = "direta";  // direta | grupo | adicionar
let ultimoDigitando = 0;
const timersDigitando = {};
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>';
const ICON_MAIS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const ICON_COPIA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
const ICON_HIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/></svg>';
const cacheMsg = {};   // id -> mensagem (texto original, sem formatação)
let editando = null;   // id da mensagem em edição
let respondendo = null; // id da mensagem que está sendo respondida
const ICON_RESP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/></svg>';
const ICON_BAIXAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
const EMOJIS = "😀 😂 😊 😍 😉 😎 🤔 😅 😢 😡 👍 👎 👏 🙏 💪 👀 🎉 ✅ ❌ ⚠️ 📎 📄 📊 💼 ☕ 🔥 ⭐ ❤️ 👋 🤝 ⏰ 📞".split(" ");

// ---------- utilidades de data ----------
const pData = s => new Date(s.replace(" ", "T"));
function horaCurta(s) { return pData(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function rotuloDia(s) {
  const d = pData(s), hoje = new Date(), ontem = new Date(Date.now() - 864e5);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function horaLista(s) {
  const d = pData(s);
  return d.toDateString() === new Date().toDateString() ? horaCurta(s) : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function linkify(t) {
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// ---------- lista de conversas ----------
async function carregarConversas() {
  conversas = await api("/api/conversas");
  renderLista();
}
function previa(c) {
  const u = c.ultima;
  if (!u) return c.tipo === "grupo" ? `${c.membros} participantes` : "Inicie a conversa";
  const quem = u.user_id === ME.id ? "Você: " : (c.tipo === "grupo" ? u.nome.split(" ")[0] + ": " : "");
  if (u.apagada) return quem + "mensagem apagada";
  return quem + (u.resumo || u.texto || (u.arquivo_nome ? "📎 " + u.arquivo_nome : ""));
}
function renderLista() {
  const el = $("#listaConversas");
  let lista = conversas;
  if (filtro === "nao_lidas") lista = lista.filter(c => c.nao_lidas > 0);
  else if (filtro !== "todas") lista = lista.filter(c => c.tipo === filtro);
  const total = conversas.reduce((s, c) => s + c.nao_lidas, 0);
  const b = $("#badgeTotal");
  b.style.display = total ? "" : "none";
  b.textContent = total > 99 ? "99+" : total;
  document.title = (total ? `(${total}) ` : "") + "Valorização Chat";
  if (!lista.length) {
    el.innerHTML = `<div class="lista-vazia">${filtro === "nao_lidas" ? "Tudo lido por aqui ✅" : "Nenhuma conversa ainda."}</div>`;
    return;
  }
  el.innerHTML = lista.map(c => `
    <div class="conv ${atual && atual.id === c.id ? "ativa" : ""} ${c.nao_lidas ? "nova" : ""}" data-id="${c.id}">
      ${c.tipo === "direta" && c.outro ? avatar(c.outro, "g") : avatarGrupo(c.nome)}
      <div class="info">
        <div class="linha1"><span class="nome">${esc(c.nome)}</span><span class="hora">${c.ultima ? horaLista(c.ultima.criado_em) : ""}</span></div>
        <div class="linha1"><span class="previa">${esc(previa(c))}</span>${c.nao_lidas ? `<span class="badge">${c.nao_lidas}</span>` : ""}</div>
      </div>
    </div>`).join("");
}
$("#listaConversas").addEventListener("click", e => {
  const c = e.target.closest(".conv");
  if (c) abrirConversa(+c.dataset.id);
});
$$(".filtros button").forEach(b => b.onclick = () => {
  $$(".filtros button").forEach(x => x.classList.remove("ativo"));
  b.classList.add("ativo");
  filtro = b.dataset.filtro;
  renderLista();
});

// ---------- conversa aberta ----------
async function abrirConversa(id, destacar) {
  if (Gravador.ativo()) Gravador.descartar();
  Player.parar();
  cancelarResposta();
  atual = await api(`/api/conversas/${id}`);
  maisAntigo = null;
  $("#boasVindas").style.display = "none";
  $("#painelConversa").style.display = "flex";
  document.body.classList.add("em-conversa");
  $("#convAvatar").innerHTML = atual.tipo === "direta" && atual.outro ? avatar(atual.outro, "g") : avatarGrupo(atual.nome);
  $("#convNome").textContent = atual.nome;
  atualizarSubtitulo();
  $("#mensagens").innerHTML = "";
  $("#mensagens").classList.remove("so-arquivos");
  $$(".abas span").forEach((s, i) => s.classList.toggle("ativo", i === 0));
  $("#digitando").textContent = "";
  limparAnexo();
  await carregarMensagens(true, destacar);
  renderMembros();
  const c = conversas.find(x => x.id === id);
  if (c) c.nao_lidas = 0;
  renderLista();
  marcarLida();
  if (innerWidth > 680) $("#texto").focus();
  history.replaceState(null, "", "#c" + id);
}
function atualizarSubtitulo() {
  if (!atual) return;
  if (atual.tipo === "direta" && atual.outro) {
    const o = atual.outro;
    $("#convSub").textContent = (o.online ? "Disponível" : "Offline") + (o.cargo ? " · " + o.cargo : "") + (o.unidade ? " · " + o.unidade : "");
  } else {
    $("#convSub").textContent = `${atual.lista_membros.length} participantes`;
  }
}
// foto trocada: atualiza os dados em memória (o desenho na tela já foi trocado em comum.js)
window.aoMudarFoto = d => {
  usuarios.forEach(u => { if (u.id === d.user_id) u.foto = d.foto; });
  conversas.forEach(c => { if (c.outro && c.outro.id === d.user_id) c.outro.foto = d.foto; if (c.ultima && c.ultima.user_id === d.user_id) c.ultima.foto = d.foto; });
  Object.values(cacheMsg).forEach(m => { if (m.user_id === d.user_id) m.foto = d.foto; });
  if (atual) {
    if (atual.outro && atual.outro.id === d.user_id) atual.outro.foto = d.foto;
    (atual.lista_membros || []).forEach(u => { if (u.id === d.user_id) u.foto = d.foto; });
  }
};
window.aoMudarPresenca = p => {
  usuarios.forEach(u => { if (u.id === p.user_id) u.online = p.online; });
  conversas.forEach(c => { if (c.outro && c.outro.id === p.user_id) c.outro.online = p.online; });
  if (atual) {
    if (atual.outro && atual.outro.id === p.user_id) atual.outro.online = p.online;
    (atual.lista_membros || []).forEach(u => { if (u.id === p.user_id) u.online = p.online; });
    atualizarSubtitulo();
  }
};

async function carregarMensagens(inicio, destacar) {
  const box = $("#mensagens");
  const url = `/api/conversas/${atual.id}/mensagens` + (maisAntigo ? `?antes=${maisAntigo}` : "");
  const msgs = await api(url);
  if (!msgs.length && !inicio) { $("#carregarMais")?.remove(); return; }
  const alturaAntes = box.scrollHeight;
  $("#carregarMais")?.remove();
  const html = msgs.map((m, i) => htmlMensagem(m, msgs[i - 1])).join("");
  box.insertAdjacentHTML("afterbegin", html);
  if (msgs.length) maisAntigo = msgs[0].id;
  if (msgs.length === 50) box.insertAdjacentHTML("afterbegin", '<button class="carregar-mais" id="carregarMais">Carregar mensagens anteriores</button>');
  if (!msgs.length && inicio) box.innerHTML = `<div class="boas-vindas" style="flex:none;margin:auto">${atual.tipo === "direta" ? "Diga olá para " + esc(atual.nome) + " 👋" : "Este é o início do grupo " + esc(atual.nome) + "."}</div>`;
  if (inicio) box.scrollTop = box.scrollHeight;
  else box.scrollTop = box.scrollHeight - alturaAntes;
  if (destacar) await irParaMensagem(destacar);
}
// rola até a mensagem (carregando as mais antigas, se preciso) e destaca
async function irParaMensagem(id) {
  let el = $(`#mensagens .msg[data-msg="${id}"]`);
  while (!el && $("#carregarMais")) { await carregarMensagens(false); el = $(`#mensagens .msg[data-msg="${id}"]`); }
  if (!el) { toast("Mensagem não encontrada", "Ela pode ter sido removida da conversa."); return; }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("destaque"); void el.offsetWidth; el.classList.add("destaque");
}
$("#mensagens").addEventListener("click", e => {
  if (e.target.id === "carregarMais") carregarMensagens(false);
  const img = e.target.closest(".img-anexo");
  if (img) { $("#visualizador img").src = img.src; $("#visualizador").classList.add("ativo"); return; }
  const ed = e.target.closest("[data-editar]");
  if (ed) { editarMensagem(+ed.dataset.editar); return; }
  const resp = e.target.closest("[data-responder]");
  if (resp) { responderMensagem(+resp.dataset.responder); return; }
  const cit = e.target.closest(".citacao[data-ir]");
  if (cit) { irParaMensagem(+cit.dataset.ir); return; }
  const mais = e.target.closest("[data-mais]");
  if (mais) { e.stopPropagation(); abrirMenuMsg(+mais.dataset.mais, mais); return; }
  // toque no celular: mostra/esconde as ações da mensagem
  const corpo = e.target.closest(".msg .corpo");
  if (corpo && !e.target.closest("a, textarea, button, .audio-player") && matchMedia("(hover: none)").matches) {
    const msg = corpo.closest(".msg");
    $$(".msg.toque").forEach(x => x !== msg && x.classList.remove("toque"));
    msg.classList.toggle("toque");
  }
});
$("#visualizador").onclick = () => $("#visualizador").classList.remove("ativo");

function htmlAnexo(m) {
  if (!m.arquivo_url) return "";
  const ext = (m.arquivo_nome.split(".").pop() || "").slice(0, 4);
  if (/^(png|jpe?g|gif|webp|bmp)$/i.test(ext))
    return `<img class="img-anexo" src="${m.arquivo_url}?ver=1" alt="${esc(m.arquivo_nome)}" loading="lazy">`;
  if (/^(mp3|m4a|ogg|oga|opus|wav|aac|weba)$/i.test(ext))   // arquivo de áudio: toca direto na conversa
    return `<div class="audio-anexo">${htmlPlayer({ src: m.arquivo_url + "?ver=1", semente: m.id })}
      <a href="${m.arquivo_url}" class="aa-nome" title="Baixar">${ICON_BAIXAR}${esc(m.arquivo_nome)}</a></div>`;
  return `<a class="anexo" href="${m.arquivo_url}"><span class="ext">${esc(ext)}</span><span>${esc(m.arquivo_nome)}</span></a>`;
}
function dataHoraCurta(s) {
  return s ? pData(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}
function htmlCitacao(r) {
  if (!r) return "";
  return `<button type="button" class="citacao ${r.apagada ? "cit-apagada" : ""}" data-ir="${r.id}" title="Ir para a mensagem original">
    <b>${esc(r.user_id === ME.id ? "Você" : r.nome)}</b><span>${esc(r.texto)}</span></button>`;
}
function corpoMensagem(m) {
  if (m.apagada) {
    const quem = m.apagada_por_admin ? "pelo administrador" : (m.user_id === ME.id ? "por você" : "");
    return `<div class="texto apagada">${ICON_DEL}<span>${m.tipo === "reuniao" ? "Reunião cancelada" : "Mensagem apagada"} ${quem}</span></div>`;
  }
  const cit = htmlCitacao(m.responde_a);
  if (m.tipo === "audio") return cit + htmlAudio(m);
  if (m.tipo === "reuniao") return cit + htmlReuniao(m);
  const ed = m.editada ? `<span class="ed" title="Editada em ${dataHoraCurta(m.editada_em)}">Editada</span>` : "";
  return cit + (m.texto ? `<div class="texto">${linkify(m.texto)}${ed}</div>` : (ed ? `<div class="texto">${ed}</div>` : ""))
    + htmlLinkReuniao(m.texto) + htmlAnexo(m);
}
function htmlAcoes(m) {
  if (m.apagada) return "";
  const minha = m.user_id === ME.id;
  return `<div class="acoes">
      <button data-responder="${m.id}" title="Responder">${ICON_RESP}</button>
      ${minha && m.tipo === "texto" ? `<button data-editar="${m.id}" title="Editar">${ICON_EDIT}</button>` : ""}
      <button data-mais="${m.id}" title="Mais opções">${ICON_MAIS}</button></div>`;
}
function htmlMensagem(m, ant) {
  let dia = "";
  if (!ant || pData(ant.criado_em).toDateString() !== pData(m.criado_em).toDateString())
    dia = `<div class="dia">${rotuloDia(m.criado_em)}</div>`;
  const cont = !dia && ant && ant.user_id === m.user_id && (pData(m.criado_em) - pData(ant.criado_em)) < 5 * 60e3;
  const minha = m.user_id === ME.id;
  cacheMsg[m.id] = m;
  const acoes = htmlAcoes(m);
  return `${dia}<div class="msg ${minha ? "minha" : ""} ${cont ? "cont" : ""} ${m.arquivo_url ? "tem-arquivo" : ""} ${m.apagada ? "foi-apagada" : ""} tipo-${m.tipo || "texto"}" data-msg="${m.id}" data-user="${m.user_id}" data-hora="${m.criado_em}">
    ${avatar({ id: m.user_id, nome: m.nome, cor: m.cor, foto: m.foto })}
    <div class="corpo"><div class="cab"><b>${esc(m.nome)}</b><time>${horaCurta(m.criado_em)}</time></div>
    <div class="cont-msg">${corpoMensagem(m)}</div></div>${acoes}</div>`;
}
function anexarMensagem(m) {
  const box = $("#mensagens");
  box.querySelector(":scope > .boas-vindas")?.remove();
  if ($(`#mensagens .msg[data-msg="${m.id}"]`)) return;
  const ultimo = [...box.querySelectorAll(".msg")].pop();
  const ant = ultimo ? { user_id: +ultimo.dataset.user, criado_em: ultimo.dataset.hora } : null;
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
  box.insertAdjacentHTML("beforeend", htmlMensagem(m, ant));
  if (perto || m.user_id === ME.id) box.scrollTop = box.scrollHeight;
}
// ---------- editar / apagar para todos ----------
function editarMensagem(id) {
  const m = cacheMsg[id];
  const el = $(`#mensagens .msg[data-msg="${id}"]`);
  if (!m || !el || m.apagada || m.user_id !== ME.id || m.tipo !== "texto") return;
  if (editando) cancelarEdicao();
  editando = id;
  fecharMenuMsg();
  el.classList.add("editando");
  const cont = el.querySelector(".cont-msg");
  cont.innerHTML = `<div class="edicao">
      <textarea rows="1">${esc(m.texto || "")}</textarea>
      <div class="edicao-barra"><small>Enter para salvar · Esc para cancelar</small>
        <button class="btn sec" data-acao="cancelar">Cancelar</button>
        <button class="btn prim" data-acao="salvar">Salvar</button></div>
    </div>${htmlLinkReuniao(m.texto)}${htmlAnexo(m)}`;
  const t = cont.querySelector("textarea");
  const ajusta = () => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; };
  ajusta(); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
  t.addEventListener("input", ajusta);
  t.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); salvarEdicao(); }
    if (e.key === "Escape") { e.preventDefault(); cancelarEdicao(); }
  });
  cont.querySelector('[data-acao="salvar"]').onclick = salvarEdicao;
  cont.querySelector('[data-acao="cancelar"]').onclick = cancelarEdicao;
}
function salvarEdicao() {
  const id = editando;
  const el = $(`#mensagens .msg[data-msg="${id}"]`);
  if (!el) return;
  const texto = el.querySelector(".edicao textarea").value.trim();
  socket.emit("editar", { id, texto }, r => {
    if (r && r.ok) { editando = null; el.classList.remove("editando"); el.querySelector(".cont-msg").innerHTML = corpoMensagem(cacheMsg[id]); }
    else toast("Não foi possível editar", (r && r.erro) || "Tente novamente.");
  });
}
function cancelarEdicao() {
  const id = editando; editando = null;
  const el = $(`#mensagens .msg[data-msg="${id}"]`);
  if (el) { el.classList.remove("editando"); el.querySelector(".cont-msg").innerHTML = corpoMensagem(cacheMsg[id]); }
  if (innerWidth > 680) ta.focus();
}
function apagarParaTodos(id) {
  const m = cacheMsg[id];
  if (!m) return;
  const alheia = m.user_id !== ME.id;
  $("#apagarTexto").textContent = alheia
    ? `A mensagem de ${m.nome} será removida desta conversa para todos os participantes.`
    : "A mensagem será removida desta conversa para todos os participantes. Essa ação não pode ser desfeita.";
  $("#apagarPrevia").textContent = m.resumo || m.texto || (m.arquivo_nome ? "📎 " + m.arquivo_nome : "");
  $("#modalApagar h3").textContent = m.tipo === "reuniao" ? "Cancelar reunião para todos?" : "Apagar para todos?";
  $("#confirmarApagar").onclick = () => {
    socket.emit("apagar", { id }, r => {
      fecharModal("modalApagar");
      if (!r || !r.ok) toast("Não foi possível apagar", (r && r.erro) || "Tente novamente.");
    });
  };
  abrirModal("modalApagar");
}
async function verHistorico(id) {
  try {
    const h = await api(`/api/admin/mensagens/${id}/historico`);
    const linhas = h.versoes.map(v => `<div class="versao"><small>${v.acao === "edicao" ? "Antes da edição" : "Apagada"} · ${esc(v.por)} · ${dataHoraCurta(v.em)}</small><div>${esc(v.texto || "(sem texto)")}</div></div>`).join("");
    $("#historicoConteudo").innerHTML = `<p class="hist-cab">Enviada por <b>${esc(h.autor)}</b> em ${dataHoraCurta(h.enviada_em)}</p>
      ${linhas || '<p class="hist-cab">Esta mensagem nunca foi alterada.</p>'}
      ${h.apagada ? "" : `<div class="versao atual"><small>Versão atual</small><div>${esc(h.atual || "(sem texto)")}</div></div>`}`;
    abrirModal("modalHistorico");
  } catch (e) { toast("Histórico indisponível", e.message); }
}
// menu "⋯" da mensagem
const menuMsg = document.createElement("div");
menuMsg.className = "menu-msg";
document.body.appendChild(menuMsg);
function abrirMenuMsg(id, botao) {
  const m = cacheMsg[id];
  if (!m) return;
  const minha = m.user_id === ME.id;
  const itens = [`<button data-op="responder">${ICON_RESP}Responder</button>`];
  if (minha && m.tipo === "texto") itens.push(`<button data-op="editar">${ICON_EDIT}Editar</button>`);
  if (m.tipo === "texto" && m.texto) itens.push(`<button data-op="copiar">${ICON_COPIA}Copiar texto</button>`);
  if (m.tipo === "reuniao") itens.push(`<button data-op="copiar-link">${ICON_LINK}Copiar link da reunião</button>`);
  if (m.tipo === "audio") itens.push(`<button data-op="baixar">${ICON_BAIXAR}Baixar áudio</button>`);
  if (ME.is_admin && (m.editada)) itens.push(`<button data-op="historico">${ICON_HIST}Ver versões anteriores</button>`);
  if (minha || ME.is_admin) itens.push(`<hr><button data-op="apagar" class="perigo">${ICON_DEL}${m.tipo === "reuniao" ? "Cancelar reunião" : "Apagar para todos"}</button>`);
  menuMsg.innerHTML = itens.join("");
  menuMsg.dataset.id = id;
  menuMsg.classList.add("ativo");
  const r = botao.getBoundingClientRect(), w = menuMsg.offsetWidth, h = menuMsg.offsetHeight;
  // abre ao lado do botão, sem cobrir o texto da mensagem
  const minhaMsg = botao.closest(".msg.minha");
  let x = minhaMsg ? r.left - w - 6 : r.right + 6, y = r.top - 4;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (x < 8) x = 8;
  if (y + h > innerHeight - 8) y = innerHeight - h - 8;
  menuMsg.style.left = x + "px"; menuMsg.style.top = y + "px";
}
function fecharMenuMsg() { menuMsg.classList.remove("ativo"); }
menuMsg.addEventListener("click", e => {
  const b = e.target.closest("[data-op]");
  if (!b) return;
  const id = +menuMsg.dataset.id, m = cacheMsg[id];
  fecharMenuMsg();
  if (b.dataset.op === "responder") responderMensagem(id);
  if (b.dataset.op === "copiar-link") navigator.clipboard?.writeText(m.meta.link).then(() => toast("Link copiado", "Link da reunião copiado."));
  if (b.dataset.op === "baixar") { const a = document.createElement("a"); a.href = m.arquivo_url; a.click(); }
  if (b.dataset.op === "editar") editarMensagem(id);
  if (b.dataset.op === "apagar") apagarParaTodos(id);
  if (b.dataset.op === "historico") verHistorico(id);
  if (b.dataset.op === "copiar") navigator.clipboard?.writeText(m.texto).then(() => toast("Copiado", "Texto da mensagem copiado."));
});
document.addEventListener("click", e => { if (!e.target.closest(".menu-msg")) fecharMenuMsg(); });
$("#mensagens").addEventListener("scroll", fecharMenuMsg);
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharMenuMsg(); });
async function marcarLida() {
  if (atual && document.visibilityState === "visible") await api(`/api/conversas/${atual.id}/lida`, { method: "POST" }).catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && atual) {
    const c = conversas.find(x => x.id === atual.id);
    if (c && c.nao_lidas) { c.nao_lidas = 0; renderLista(); }
    marcarLida();
  }
});

// abas Chat / Arquivos
$$(".abas span").forEach((s, i) => s.onclick = () => {
  $$(".abas span").forEach(x => x.classList.remove("ativo"));
  s.classList.add("ativo");
  $("#mensagens").classList.toggle("so-arquivos", i === 1);
});

// ---------- tempo real ----------
socket.on("mensagem", m => {
  const c = conversas.find(x => x.id === m.conversa_id);
  if (!c) { carregarConversas(); }
  else {
    c.ultima = m;
    const aberta = atual && atual.id === m.conversa_id && document.visibilityState === "visible";
    if (m.user_id !== ME.id && !aberta) c.nao_lidas++;
    conversas.sort((a, b) => (b.ultima?.id || 0) - (a.ultima?.id || 0));
    renderLista();
  }
  Reunioes.aoReceber(m);
  if (atual && atual.id === m.conversa_id) {
    anexarMensagem(m);
    $("#digitando").textContent = "";
    marcarLida();
  }
  if (m.user_id !== ME.id && (!atual || atual.id !== m.conversa_id || document.visibilityState !== "visible")) notificar(m, c);
});
socket.on("mensagem_alterada", m => {
  const el = $(`#mensagens .msg[data-msg="${m.id}"]`);
  cacheMsg[m.id] = m;
  if (el) {
    if (editando === m.id && m.apagada) { editando = null; el.classList.remove("editando"); }
    if (editando !== m.id) el.querySelector(".cont-msg").innerHTML = corpoMensagem(m);
    el.classList.toggle("foi-apagada", m.apagada);
    el.querySelector(".acoes")?.remove();
    el.insertAdjacentHTML("beforeend", htmlAcoes(m));
  }
  // citações desta mensagem em outras respostas
  if (m.citacao_atualizada) {
    Object.values(cacheMsg).forEach(x => { if (x.responde_a && x.responde_a.id === m.id) x.responde_a = m.citacao_atualizada; });
    $$(`.citacao[data-ir="${m.id}"]`).forEach(c => c.outerHTML = htmlCitacao(m.citacao_atualizada));
  }
  if (respondendo === m.id && m.apagada) cancelarResposta();
  Reunioes.aoAlterar(m);
  const c = conversas.find(x => x.id === m.conversa_id);
  if (c && c.ultima && c.ultima.id === m.id) { c.ultima = m; renderLista(); }
});
socket.on("conversa_nova", () => carregarConversas());
socket.on("usuarios_mudaram", () => carregarUsuarios());
socket.on("connect", () => { if (conversas.length) carregarConversas(); });
socket.on("digitando", d => {
  if (!atual || atual.id !== d.conversa_id) return;
  $("#digitando").textContent = `${d.nome.split(" ")[0]} está digitando…`;
  clearTimeout(timersDigitando[d.conversa_id]);
  timersDigitando[d.conversa_id] = setTimeout(() => $("#digitando").textContent = "", 3000);
});

function notificar(m, c) {
  const titulo = c && c.tipo === "grupo" ? `${m.nome} em ${c.nome}` : m.nome;
  const corpo = m.resumo || m.texto || (m.arquivo_nome ? "📎 " + m.arquivo_nome : "");
  toast(titulo, corpo, () => abrirConversa(m.conversa_id));
  if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
    const n = new Notification(titulo, { body: corpo, icon: "/static/icone.png", tag: "conv" + m.conversa_id });
    n.onclick = () => { window.focus(); abrirConversa(m.conversa_id); n.close(); };
  }
  tocarSom();
}
let audioCtx;
function tocarSom() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.setValueAtTime(1175, audioCtx.currentTime + .09);
    g.gain.setValueAtTime(.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .3);
    o.start(); o.stop(audioCtx.currentTime + .3);
  } catch (e) {}
}
document.addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
}, { once: true });

// ---------- envio ----------
const ta = $("#texto");
function ajustarAltura() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px"; }
function atualizarBotao() {
  const vazio = !ta.value.trim() && !anexo;
  $("#btnEnviar").disabled = vazio;
  $("#caixa").classList.toggle("tem-conteudo", !vazio);
}
// ---------- responder ----------
function responderMensagem(id) {
  const m = cacheMsg[id];
  if (!m || m.apagada) return;
  fecharMenuMsg();
  if (editando) cancelarEdicao();
  respondendo = id;
  $("#respostaNome").textContent = m.user_id === ME.id ? "Respondendo a você mesmo" : `Respondendo a ${m.nome}`;
  $("#respostaResumo").textContent = m.resumo || m.texto || "";
  $("#respostaBarra").classList.add("ativo");
  $$(".msg.respondendo").forEach(x => x.classList.remove("respondendo"));
  $(`#mensagens .msg[data-msg="${id}"]`)?.classList.add("respondendo");
  ta.focus();
}
function cancelarResposta() {
  respondendo = null;
  $("#respostaBarra").classList.remove("ativo");
  $$(".msg.respondendo").forEach(x => x.classList.remove("respondendo"));
}
$("#cancelarResposta").onclick = () => { cancelarResposta(); ta.focus(); };
$("#respostaBarra").addEventListener("click", e => { if (!e.target.closest("button") && respondendo) irParaMensagem(respondendo); });
ta.addEventListener("input", () => {
  ajustarAltura(); atualizarBotao();
  if (atual && Date.now() - ultimoDigitando > 2000) { ultimoDigitando = Date.now(); socket.emit("digitando", { conversa_id: atual.id }); }
});
ta.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
  if (e.key === "Escape" && respondendo) { e.preventDefault(); cancelarResposta(); }
  if (e.key === "ArrowUp" && !ta.value) {
    const minhas = $$("#mensagens .msg.minha:not(.foi-apagada)");
    const ultima = minhas[minhas.length - 1];
    if (ultima) { e.preventDefault(); editarMensagem(+ultima.dataset.msg); ultima.scrollIntoView({ block: "nearest" }); }
  }
});
$("#btnEnviar").onclick = enviar;
async function enviar() {
  if (!atual) return;
  const texto = ta.value.trim();
  if (!texto && !anexo) return;
  if (anexo) {
    const fd = new FormData();
    fd.append("arquivo", anexo);
    fd.append("texto", texto);
    if (respondendo) fd.append("responde_a", respondendo);
    $("#btnEnviar").disabled = true;
    try { await api(`/api/conversas/${atual.id}/arquivo`, { method: "POST", body: fd }); }
    catch (e) { toast("Falha no envio", e.message); return; }
    limparAnexo();
  } else {
    socket.emit("enviar", { conversa_id: atual.id, texto, responde_a: respondendo }, r => { if (!r || !r.ok) toast("Falha no envio", "A mensagem não foi entregue. Tente novamente."); });
  }
  cancelarResposta();
  ta.value = ""; ajustarAltura(); atualizarBotao();
}
$("#btnAnexo").onclick = () => $("#arquivo").click();
$("#arquivo").onchange = e => { if (e.target.files[0]) definirAnexo(e.target.files[0]); };
function definirAnexo(f) {
  if (f.size > 25 * 1024 * 1024) { toast("Arquivo muito grande", "O limite é 25 MB."); return; }
  anexo = f;
  $("#anexoNome").textContent = `${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
  $("#anexoPrevia").classList.add("ativo");
  atualizarBotao();
}
function limparAnexo() { anexo = null; $("#arquivo").value = ""; $("#anexoPrevia").classList.remove("ativo"); atualizarBotao(); }
$("#removerAnexo").onclick = limparAnexo;
// arrastar e soltar / colar imagem
$("#chat").addEventListener("dragover", e => e.preventDefault());
$("#chat").addEventListener("drop", e => { e.preventDefault(); if (atual && e.dataTransfer.files[0]) definirAnexo(e.dataTransfer.files[0]); });
ta.addEventListener("paste", e => {
  const f = [...(e.clipboardData?.files || [])][0];
  if (f) { e.preventDefault(); definirAnexo(f); }
});
// emojis
$("#emojiPainel").innerHTML = EMOJIS.map(e => `<button type="button">${e}</button>`).join("");
$("#btnEmoji").onclick = e => { e.stopPropagation(); $("#emojiPainel").classList.toggle("ativo"); };
$("#emojiPainel").onclick = e => {
  if (e.target.tagName !== "BUTTON") return;
  const p = ta.selectionStart;
  ta.value = ta.value.slice(0, p) + e.target.textContent + ta.value.slice(ta.selectionEnd);
  ta.focus(); ta.selectionStart = ta.selectionEnd = p + e.target.textContent.length;
  atualizarBotao();
};
document.addEventListener("click", e => { if (!e.target.closest("#emojiPainel")) $("#emojiPainel").classList.remove("ativo"); });

// ---------- mobile ----------
$("#btnVoltar").onclick = () => {
  document.body.classList.remove("em-conversa");
  $("#lateral").classList.remove("ativo");
  atual = null; renderLista();
  history.replaceState(null, "", location.pathname);
};

// ---------- participantes ----------
function renderMembros() {
  if (!atual) return;
  $("#listaMembros").innerHTML = atual.lista_membros.map(u => `
    <div class="membro">${avatar(u)}<div><b>${esc(u.nome)}${u.id === ME.id ? " (você)" : ""}</b>
    <small>${esc([u.cargo, u.unidade].filter(Boolean).join(" · ") || "@" + u.username)}</small></div></div>`).join("");
  $("#acoesGrupo").style.display = atual.tipo === "grupo" ? "flex" : "none";
}
$("#btnMembros").onclick = () => $("#lateral").classList.toggle("ativo");
$("#fecharLateral").onclick = () => $("#lateral").classList.remove("ativo");
$("#btnSairGrupo").onclick = async () => {
  if (!confirm(`Sair do grupo "${atual.nome}"? O histórico continuará salvo para os demais participantes.`)) return;
  await api(`/api/conversas/${atual.id}/sair`, { method: "POST" });
  $("#lateral").classList.remove("ativo");
  atual = null;
  $("#painelConversa").style.display = "none";
  $("#boasVindas").style.display = "";
  document.body.classList.remove("em-conversa");
  carregarConversas();
};

// ---------- nova conversa / grupo ----------
async function carregarUsuarios() { usuarios = await api("/api/usuarios"); }
function abrirNovaConversa(modo = "direta") {
  modoModal = modo;
  $("#novaTitulo").textContent = { direta: "Nova conversa", grupo: "Novo grupo", adicionar: "Adicionar participantes" }[modo];
  $("#campoNomeGrupo").style.display = modo === "grupo" ? "" : "none";
  $("#confirmarNova").style.display = modo === "direta" ? "none" : "";
  $("#confirmarNova").textContent = modo === "grupo" ? "Criar grupo" : "Adicionar";
  $("#erroNova").textContent = "";
  $("#nomeGrupo").value = ""; $("#filtroUsuarios").value = "";
  renderSelecao();
  abrirModal("modalNova");
  setTimeout(() => (modo === "grupo" ? $("#nomeGrupo") : $("#filtroUsuarios")).focus(), 50);
}
window.abrirNovaConversa = abrirNovaConversa;
function renderSelecao() {
  const termo = $("#filtroUsuarios").value.toLowerCase();
  const jaNoGrupo = modoModal === "adicionar" ? new Set(atual.lista_membros.map(u => u.id)) : new Set();
  const lista = usuarios.filter(u => u.id !== ME.id && !jaNoGrupo.has(u.id) &&
    (u.nome + " " + u.username + " " + u.cargo + " " + u.unidade).toLowerCase().includes(termo));
  $("#selecUsuarios").innerHTML = lista.length ? lista.map(u => `
    <label data-uid="${u.id}">${modoModal !== "direta" ? `<input type="checkbox" value="${u.id}">` : ""}
      ${avatar(u)}<div><b>${esc(u.nome)}</b><small>${esc([u.cargo, u.unidade].filter(Boolean).join(" · ") || "@" + u.username)}</small></div></label>`).join("")
    : '<div class="lista-vazia">Nenhuma pessoa encontrada.</div>';
}
$("#filtroUsuarios").oninput = renderSelecao;
$("#selecUsuarios").addEventListener("click", async e => {
  if (modoModal !== "direta") return;
  const l = e.target.closest("label");
  if (!l) return;
  const r = await api("/api/conversas", { method: "POST", body: { tipo: "direta", user_id: +l.dataset.uid } });
  fecharModal("modalNova");
  await carregarConversas();
  abrirConversa(r.id);
});
$("#confirmarNova").onclick = async () => {
  const ids = $$("#selecUsuarios input:checked").map(i => +i.value);
  try {
    if (modoModal === "grupo") {
      const r = await api("/api/conversas", { method: "POST", body: { tipo: "grupo", nome: $("#nomeGrupo").value, membros: ids } });
      fecharModal("modalNova");
      await carregarConversas();
      abrirConversa(r.id);
    } else {
      if (!ids.length) { $("#erroNova").textContent = "Selecione ao menos uma pessoa."; return; }
      await api(`/api/conversas/${atual.id}/membros`, { method: "POST", body: { membros: ids } });
      fecharModal("modalNova");
      abrirConversa(atual.id);
    }
  } catch (e) { $("#erroNova").textContent = e.message; }
};
$("#btnNovaConversa").onclick = () => abrirNovaConversa("direta");
$("#btnNovoGrupo").onclick = () => abrirNovaConversa("grupo");
$("#btnAddMembros").onclick = () => abrirNovaConversa("adicionar");

// ---------- busca ----------
let tBusca;
$("#busca").addEventListener("input", e => {
  clearTimeout(tBusca);
  const q = e.target.value.trim();
  if (q.length < 2) { $("#resultados").classList.remove("ativo"); return; }
  tBusca = setTimeout(async () => {
    const r = await api("/api/buscar?q=" + encodeURIComponent(q));
    const nomeConv = id => (conversas.find(c => c.id === id) || {}).nome || "";
    $("#resultados").innerHTML = r.length ? r.map(m => `
      <div class="item" data-conv="${m.conversa_id}" data-alvo="${m.id}">
        <small>${esc(m.nome)} · ${esc(nomeConv(m.conversa_id))} · ${horaLista(m.criado_em)}</small>
        ${esc((m.resumo || m.texto || "📎 " + m.arquivo_nome).slice(0, 140))}</div>`).join("")
      : '<div class="vazio">Nada encontrado.</div>';
    $("#resultados").classList.add("ativo");
  }, 250);
});
$("#resultados").addEventListener("click", e => {
  const i = e.target.closest(".item");
  if (!i) return;
  $("#resultados").classList.remove("ativo");
  $("#busca").value = "";
  abrirConversa(+i.dataset.conv, +i.dataset.alvo);
});
document.addEventListener("click", e => { if (!e.target.closest(".busca")) $("#resultados").classList.remove("ativo"); });

// ---------- inicialização ----------
$("#railReunioes").onclick = e => {
  e.preventDefault();
  $$(".rail a").forEach(a => a.classList.remove("ativo"));
  $("#railReunioes").classList.add("ativo");
  Reunioes.mostrarPainel(true);
  if (innerWidth <= 680) $("#btnVoltar").click();
};
$("#railGrupos").onclick = e => {
  e.preventDefault();
  Reunioes.mostrarPainel(false);
  $$(".rail a").forEach(a => a.classList.remove("ativo"));
  $("#railGrupos").classList.add("ativo");
  $(`.filtros [data-filtro="grupo"]`).click();
  $("#tituloLista").textContent = "Equipes";
  if (innerWidth <= 680) $("#btnVoltar").click();
};
$("#railChat").onclick = e => {
  e.preventDefault();
  Reunioes.mostrarPainel(false);
  $$(".rail a").forEach(a => a.classList.remove("ativo"));
  $("#railChat").classList.add("ativo");
  $(`.filtros [data-filtro="todas"]`).click();
  $("#tituloLista").textContent = "Chat";
};
(async () => {
  await Promise.all([carregarConversas(), carregarUsuarios(), Reunioes.carregar()]);
  if (location.hash === "#grupos") $("#railGrupos").click();
  if (location.hash === "#reunioes") $("#railReunioes").click();
  Reunioes.verificar();
  const m = location.hash.match(/^#c(\d+)$/);
  if (m && conversas.some(c => c.id === +m[1])) abrirConversa(+m[1]);
})();
