"""
Valorização Chat — chat interno estilo Microsoft Teams
Flask + Flask-SocketIO + SQLite (todas as mensagens ficam armazenadas em chat.db)
"""
import os
import re
import json
import sqlite3
import secrets
import uuid
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, render_template, request, redirect, url_for, session,
                   jsonify, g, send_from_directory, abort)
from flask_socketio import SocketIO, join_room, emit
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from PIL import Image, ImageOps, UnidentifiedImageError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "chat.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
FOTOS_DIR = os.path.join(UPLOAD_DIR, "fotos")
MAX_FOTO_MB = 8
SECRET_FILE = os.path.join(BASE_DIR, ".secret_key")
MAX_UPLOAD_MB = 25
CORES_AVATAR = ["#FC4900", "#E8590C", "#C2410C", "#5F6368", "#3F4448", "#B45309",
                "#D9480F", "#7C2D12", "#4B5563", "#9A3412"]

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(FOTOS_DIR, exist_ok=True)


def carregar_secret():
    if os.path.exists(SECRET_FILE):
        return open(SECRET_FILE).read().strip()
    chave = secrets.token_hex(32)
    with open(SECRET_FILE, "w") as f:
        f.write(chave)
    return chave


app = Flask(__name__)
app.config["SECRET_KEY"] = carregar_secret()
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
socketio = SocketIO(app, async_mode="threading", manage_session=False)
# Sem WebSocket (ex.: plano grátis do PythonAnywhere) o navegador consulta o servidor a cada 3 s.
app.config["TEMPO_REAL"] = os.environ.get("TEMPO_REAL", "1") != "0" and "PYTHONANYWHERE_DOMAIN" not in os.environ

# usuários online: user_id -> quantidade de conexões abertas
online = {}


# ---------------------------------------------------------------- banco
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def fechar_db(_):
    conn = g.pop("db", None)
    if conn:
        conn.close()


def agora():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        nome TEXT NOT NULL,
        cargo TEXT DEFAULT '',
        unidade TEXT DEFAULT '',
        senha_hash TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        ativo INTEGER DEFAULT 1,
        trocar_senha INTEGER DEFAULT 1,
        cor TEXT DEFAULT '#FC4900',
        criado_em TEXT,
        ultimo_acesso TEXT
    );
    CREATE TABLE IF NOT EXISTS conversas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK (tipo IN ('direta','grupo')),
        nome TEXT,
        criado_por INTEGER REFERENCES users(id),
        criado_em TEXT
    );
    CREATE TABLE IF NOT EXISTS membros (
        conversa_id INTEGER REFERENCES conversas(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ultima_lida INTEGER DEFAULT 0,
        PRIMARY KEY (conversa_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS mensagens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversa_id INTEGER REFERENCES conversas(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        texto TEXT DEFAULT '',
        arquivo_nome TEXT,
        arquivo_path TEXT,
        editada INTEGER DEFAULT 0,
        apagada INTEGER DEFAULT 0,
        criado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON mensagens(conversa_id, id);
    CREATE TABLE IF NOT EXISTS mensagens_versoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mensagem_id INTEGER REFERENCES mensagens(id) ON DELETE CASCADE,
        acao TEXT NOT NULL,              -- 'edicao' ou 'exclusao'
        texto_anterior TEXT,
        feito_por INTEGER REFERENCES users(id),
        feito_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_versoes_msg ON mensagens_versoes(mensagem_id);
    """)
    # atualização de bancos criados pela versão anterior
    for tabela, col in (("mensagens", "editada_em TEXT"), ("mensagens", "apagada_em TEXT"),
                        ("mensagens", "apagada_por INTEGER"), ("users", "foto TEXT"),
                        ("mensagens", "responde_a INTEGER"), ("mensagens", "tipo TEXT DEFAULT 'texto'"),
                        ("mensagens", "meta TEXT")):
        try:
            conn.execute(f"ALTER TABLE {tabela} ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass
    if not conn.execute("SELECT 1 FROM users WHERE is_admin = 1").fetchone():
        conn.execute(
            "INSERT INTO users (username, nome, cargo, senha_hash, is_admin, trocar_senha, cor, criado_em)"
            " VALUES (?,?,?,?,1,1,?,?)",
            ("admin", "Administrador", "TI", generate_password_hash("admin123"), "#FC4900", agora()))
        # canal geral para todos
        cur = conn.execute("INSERT INTO conversas (tipo, nome, criado_por, criado_em) VALUES ('grupo','Geral',1,?)",
                           (agora(),))
        conn.execute("INSERT INTO membros (conversa_id, user_id) VALUES (?,1)", (cur.lastrowid,))
        print("\n>>> Usuário administrador criado: admin / admin123 (troque no primeiro acesso)\n")
    conn.commit()
    conn.close()


# ---------------------------------------------------------------- auth
def usuario_atual():
    uid = session.get("uid")
    if not uid:
        return None
    u = db().execute("SELECT * FROM users WHERE id = ? AND ativo = 1", (uid,)).fetchone()
    return u


def login_obrigatorio(f):
    @wraps(f)
    def w(*a, **k):
        u = usuario_atual()
        if not u:
            if request.path.startswith("/api/"):
                return jsonify(erro="Não autenticado"), 401
            return redirect(url_for("login"))
        g.user = u
        return f(*a, **k)
    return w


def admin_obrigatorio(f):
    @wraps(f)
    @login_obrigatorio
    def w(*a, **k):
        if not g.user["is_admin"]:
            if request.path.startswith("/api/"):
                return jsonify(erro="Acesso restrito ao administrador"), 403
            return redirect(url_for("index"))
        return f(*a, **k)
    return w


def foto_url(uid, arquivo):
    # o nome do arquivo muda a cada troca, então serve de "versão" para o navegador não usar a foto antiga
    return url_for("foto", uid=uid, v=arquivo.split("_")[-1].split(".")[0]) if arquivo else None


def user_publico(u):
    return {"id": u["id"], "username": u["username"], "nome": u["nome"], "cargo": u["cargo"] or "",
            "unidade": u["unidade"] or "", "cor": u["cor"], "is_admin": bool(u["is_admin"]),
            "foto": foto_url(u["id"], u["foto"]), "online": u["id"] in online}


def eh_membro(conv_id, uid):
    return db().execute("SELECT 1 FROM membros WHERE conversa_id=? AND user_id=?", (conv_id, uid)).fetchone()


def membros_ids(conv_id):
    return [r[0] for r in db().execute("SELECT user_id FROM membros WHERE conversa_id=?", (conv_id,))]


def resumo_texto(m):
    """Texto curto para citação, prévia da lista e notificações."""
    if m["apagada"]:
        return "Mensagem apagada"
    tipo = m["tipo"] or "texto"
    meta = json.loads(m["meta"]) if m["meta"] else {}
    if tipo == "audio":
        seg = int(meta.get("duracao") or 0)
        return f"🎤 Mensagem de voz ({seg // 60}:{seg % 60:02d})"
    if tipo == "reuniao":
        return f"📅 Reunião: {meta.get('titulo') or m['texto']}"
    if m["texto"]:
        return m["texto"]
    return f"📎 {m['arquivo_nome']}" if m["arquivo_nome"] else ""


def citacao(msg_id):
    if not msg_id:
        return None
    o = db().execute(SQL_MSG + " WHERE m.id=?", (msg_id,)).fetchone()
    if not o:
        return None
    return {"id": o["id"], "user_id": o["user_id"], "nome": o["nome"], "tipo": o["tipo"] or "texto",
            "apagada": bool(o["apagada"]), "texto": resumo_texto(o)[:220]}


def msg_dict(m):
    meta = json.loads(m["meta"]) if m["meta"] and not m["apagada"] else None
    return {"id": m["id"], "conversa_id": m["conversa_id"], "user_id": m["user_id"],
            "tipo": m["tipo"] or "texto", "meta": meta,
            "responde_a": citacao(m["responde_a"]), "resumo": resumo_texto(m)[:220],
            "nome": m["nome"], "cor": m["cor"], "foto": foto_url(m["user_id"], m["foto"]),
            "texto": "" if m["apagada"] else m["texto"],
            "arquivo_nome": None if m["apagada"] else m["arquivo_nome"],
            "arquivo_url": (url_for("baixar", msg_id=m["id"]) if m["arquivo_path"] and not m["apagada"] else None),
            "editada": bool(m["editada"]), "editada_em": m["editada_em"],
            "apagada": bool(m["apagada"]), "apagada_em": m["apagada_em"],
            "apagada_por_admin": bool(m["apagada"] and m["apagada_por"] and m["apagada_por"] != m["user_id"]),
            "criado_em": m["criado_em"]}


SQL_MSG = """SELECT m.*, u.nome, u.cor, u.foto FROM mensagens m JOIN users u ON u.id = m.user_id"""


def conversa_dict(c, uid):
    d = db()
    info = {"id": c["id"], "tipo": c["tipo"], "nome": c["nome"]}
    if c["tipo"] == "direta":
        outro = d.execute("""SELECT u.* FROM membros mb JOIN users u ON u.id = mb.user_id
                             WHERE mb.conversa_id = ? AND mb.user_id <> ?""", (c["id"], uid)).fetchone()
        if outro:
            info.update(nome=outro["nome"], outro=user_publico(outro))
        else:
            info.update(nome="(somente você)")
    else:
        info["membros"] = len(membros_ids(c["id"]))
    ult = d.execute(SQL_MSG + " WHERE m.conversa_id = ? ORDER BY m.id DESC LIMIT 1", (c["id"],)).fetchone()
    info["ultima"] = msg_dict(ult) if ult else None
    lida = d.execute("SELECT ultima_lida FROM membros WHERE conversa_id=? AND user_id=?", (c["id"], uid)).fetchone()
    info["nao_lidas"] = d.execute(
        "SELECT COUNT(*) FROM mensagens WHERE conversa_id=? AND id>? AND user_id<>?",
        (c["id"], lida[0] if lida else 0, uid)).fetchone()[0]
    return info


# ---------------------------------------------------------------- páginas
@app.route("/login", methods=["GET", "POST"])
def login():
    erro = None
    if request.method == "POST":
        user = request.form.get("username", "").strip()
        senha = request.form.get("senha", "")
        u = db().execute("SELECT * FROM users WHERE username = ?", (user,)).fetchone()
        if not u or not check_password_hash(u["senha_hash"], senha):
            erro = "Usuário ou senha inválidos."
        elif not u["ativo"]:
            erro = "Usuário desativado. Procure o administrador."
        else:
            session.clear()
            session["uid"] = u["id"]
            session.permanent = True
            db().execute("UPDATE users SET ultimo_acesso=? WHERE id=?", (agora(), u["id"]))
            db().commit()
            return redirect(url_for("index"))
    return render_template("login.html", erro=erro)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_obrigatorio
def index():
    return render_template("index.html", me=user_publico(g.user), trocar_senha=bool(g.user["trocar_senha"]), pagina="chat")


@app.route("/arquivo/<int:msg_id>")
@login_obrigatorio
def baixar(msg_id):
    m = db().execute("SELECT * FROM mensagens WHERE id=?", (msg_id,)).fetchone()
    if not m or not m["arquivo_path"] or m["apagada"] or not eh_membro(m["conversa_id"], g.user["id"]):
        abort(404)
    inline = request.args.get("ver") == "1"
    return send_from_directory(UPLOAD_DIR, m["arquivo_path"], download_name=m["arquivo_nome"],
                               as_attachment=not inline)


# ---------------------------------------------------------------- API usuário
# ---------------------------------------------------------------- fotos de perfil
@app.route("/foto/<int:uid>")
@login_obrigatorio
def foto(uid):
    u = db().execute("SELECT foto FROM users WHERE id=?", (uid,)).fetchone()
    if not u or not u["foto"] or not os.path.exists(os.path.join(FOTOS_DIR, u["foto"])):
        abort(404)
    resp = send_from_directory(FOTOS_DIR, u["foto"], mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return resp


def salvar_foto(uid, arquivo):
    """Valida, corrige a rotação, recorta em quadrado e grava 320x320 em JPEG. Devolve (ok, erro)."""
    if not arquivo or not arquivo.filename:
        return "Nenhuma imagem enviada."
    dados = arquivo.read()
    if len(dados) > MAX_FOTO_MB * 1024 * 1024:
        return f"A imagem passa de {MAX_FOTO_MB} MB."
    try:
        from io import BytesIO
        img = Image.open(BytesIO(dados))
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            fundo = Image.new("RGB", img.size, (255, 255, 255))
            fundo.paste(img, mask=img.getchannel("A"))
            img = fundo
        else:
            img = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return "Arquivo não é uma imagem válida (use JPG, PNG ou WEBP)."
    img = ImageOps.fit(img, (320, 320), Image.LANCZOS)
    nome = f"{uid}_{uuid.uuid4().hex[:10]}.jpg"
    img.save(os.path.join(FOTOS_DIR, nome), "JPEG", quality=88, optimize=True)
    remover_arquivo_foto(uid)
    db().execute("UPDATE users SET foto=? WHERE id=?", (nome, uid))
    db().commit()
    avisar_foto(uid)
    return None


def remover_arquivo_foto(uid):
    u = db().execute("SELECT foto FROM users WHERE id=?", (uid,)).fetchone()
    if u and u["foto"]:
        try:
            os.remove(os.path.join(FOTOS_DIR, u["foto"]))
        except OSError:
            pass


def avisar_foto(uid):
    u = db().execute("SELECT id, foto FROM users WHERE id=?", (uid,)).fetchone()
    socketio.emit("foto_alterada", {"user_id": uid, "foto": foto_url(uid, u["foto"])})


@app.post("/api/foto")
@login_obrigatorio
def api_minha_foto():
    erro = salvar_foto(g.user["id"], request.files.get("foto"))
    if erro:
        return jsonify(erro=erro), 400
    return jsonify(user_publico(db().execute("SELECT * FROM users WHERE id=?", (g.user["id"],)).fetchone()))


@app.delete("/api/foto")
@login_obrigatorio
def api_remover_minha_foto():
    remover_arquivo_foto(g.user["id"])
    db().execute("UPDATE users SET foto=NULL WHERE id=?", (g.user["id"],))
    db().commit()
    avisar_foto(g.user["id"])
    return jsonify(ok=True)


@app.get("/api/me")
@login_obrigatorio
def api_me():
    return jsonify(user_publico(g.user))


@app.post("/api/senha")
@login_obrigatorio
def api_senha():
    dados = request.get_json() or {}
    atual, nova = dados.get("atual", ""), dados.get("nova", "")
    if not check_password_hash(g.user["senha_hash"], atual):
        return jsonify(erro="Senha atual incorreta."), 400
    if len(nova) < 6:
        return jsonify(erro="A nova senha precisa ter ao menos 6 caracteres."), 400
    db().execute("UPDATE users SET senha_hash=?, trocar_senha=0 WHERE id=?",
                 (generate_password_hash(nova), g.user["id"]))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/usuarios")
@login_obrigatorio
def api_usuarios():
    rows = db().execute("SELECT * FROM users WHERE ativo=1 ORDER BY nome").fetchall()
    return jsonify([user_publico(u) for u in rows])


@app.get("/api/conversas")
@login_obrigatorio
def api_conversas():
    rows = db().execute("""SELECT c.* FROM conversas c JOIN membros mb ON mb.conversa_id = c.id
                           WHERE mb.user_id = ?""", (g.user["id"],)).fetchall()
    lista = [conversa_dict(c, g.user["id"]) for c in rows]
    lista.sort(key=lambda x: (x["ultima"]["id"] if x["ultima"] else 0), reverse=True)
    return jsonify(lista)


@app.post("/api/conversas")
@login_obrigatorio
def api_nova_conversa():
    dados = request.get_json() or {}
    uid = g.user["id"]
    d = db()
    if dados.get("tipo") == "direta":
        outro = int(dados.get("user_id", 0))
        if not d.execute("SELECT 1 FROM users WHERE id=? AND ativo=1", (outro,)).fetchone():
            return jsonify(erro="Usuário não encontrado."), 404
        existe = d.execute("""SELECT c.id FROM conversas c
            JOIN membros a ON a.conversa_id=c.id AND a.user_id=?
            JOIN membros b ON b.conversa_id=c.id AND b.user_id=?
            WHERE c.tipo='direta'""", (uid, outro)).fetchone()
        if existe:
            return jsonify(id=existe[0])
        cur = d.execute("INSERT INTO conversas (tipo, criado_por, criado_em) VALUES ('direta',?,?)", (uid, agora()))
        cid = cur.lastrowid
        d.executemany("INSERT INTO membros (conversa_id, user_id) VALUES (?,?)", [(cid, uid), (cid, outro)])
        d.commit()
        return jsonify(id=cid)
    nome = (dados.get("nome") or "").strip()
    if not nome:
        return jsonify(erro="Informe o nome do grupo."), 400
    ids = {int(i) for i in dados.get("membros", [])} | {uid}
    cur = d.execute("INSERT INTO conversas (tipo, nome, criado_por, criado_em) VALUES ('grupo',?,?,?)",
                    (nome[:80], uid, agora()))
    cid = cur.lastrowid
    d.executemany("INSERT OR IGNORE INTO membros (conversa_id, user_id) VALUES (?,?)", [(cid, i) for i in ids])
    d.commit()
    for i in ids:
        socketio.emit("conversa_nova", {"id": cid}, to=f"u{i}")
    return jsonify(id=cid)


@app.get("/api/conversas/<int:cid>")
@login_obrigatorio
def api_conversa(cid):
    if not eh_membro(cid, g.user["id"]):
        abort(403)
    c = db().execute("SELECT * FROM conversas WHERE id=?", (cid,)).fetchone()
    info = conversa_dict(c, g.user["id"])
    rows = db().execute("""SELECT u.* FROM membros mb JOIN users u ON u.id=mb.user_id
                           WHERE mb.conversa_id=? ORDER BY u.nome""", (cid,)).fetchall()
    info["lista_membros"] = [user_publico(u) for u in rows]
    return jsonify(info)


@app.post("/api/conversas/<int:cid>/membros")
@login_obrigatorio
def api_add_membros(cid):
    c = db().execute("SELECT * FROM conversas WHERE id=?", (cid,)).fetchone()
    if not c or c["tipo"] != "grupo" or not eh_membro(cid, g.user["id"]):
        abort(403)
    ids = [int(i) for i in (request.get_json() or {}).get("membros", [])]
    db().executemany("INSERT OR IGNORE INTO membros (conversa_id, user_id) VALUES (?,?)", [(cid, i) for i in ids])
    db().commit()
    for i in ids:
        socketio.emit("conversa_nova", {"id": cid}, to=f"u{i}")
    return jsonify(ok=True)


@app.post("/api/conversas/<int:cid>/sair")
@login_obrigatorio
def api_sair(cid):
    c = db().execute("SELECT * FROM conversas WHERE id=?", (cid,)).fetchone()
    if not c or c["tipo"] != "grupo":
        abort(400)
    db().execute("DELETE FROM membros WHERE conversa_id=? AND user_id=?", (cid, g.user["id"]))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/conversas/<int:cid>/mensagens")
@login_obrigatorio
def api_mensagens(cid):
    if not eh_membro(cid, g.user["id"]):
        abort(403)
    antes = request.args.get("antes", type=int)
    q = SQL_MSG + " WHERE m.conversa_id=?"
    params = [cid]
    if antes:
        q += " AND m.id < ?"
        params.append(antes)
    rows = db().execute(q + " ORDER BY m.id DESC LIMIT 50", params).fetchall()
    return jsonify([msg_dict(m) for m in reversed(rows)])


@app.get("/api/buscar")
@login_obrigatorio
def api_buscar():
    termo = request.args.get("q", "").strip()
    if len(termo) < 2:
        return jsonify([])
    rows = db().execute(SQL_MSG + """ JOIN membros mb ON mb.conversa_id = m.conversa_id AND mb.user_id = ?
        WHERE m.apagada=0 AND (m.texto LIKE ? OR m.arquivo_nome LIKE ?) ORDER BY m.id DESC LIMIT 30""",
                        (g.user["id"], f"%{termo}%", f"%{termo}%")).fetchall()
    return jsonify([msg_dict(m) for m in rows])


@app.post("/api/conversas/<int:cid>/lida")
@login_obrigatorio
def api_lida(cid):
    ult = db().execute("SELECT COALESCE(MAX(id),0) FROM mensagens WHERE conversa_id=?", (cid,)).fetchone()[0]
    db().execute("UPDATE membros SET ultima_lida=? WHERE conversa_id=? AND user_id=?", (ult, cid, g.user["id"]))
    db().commit()
    return jsonify(ok=True)


def id_resposta_valido(cid, valor):
    """Só aceita responder a uma mensagem da mesma conversa."""
    try:
        rid = int(valor or 0)
    except (TypeError, ValueError):
        return None
    if not rid:
        return None
    ok = db().execute("SELECT 1 FROM mensagens WHERE id=? AND conversa_id=?", (rid, cid)).fetchone()
    return rid if ok else None


def gravar_e_enviar(cid, uid, texto, arquivo_nome=None, arquivo_path=None, responde_a=None, tipo="texto", meta=None):
    d = db()
    cur = d.execute("""INSERT INTO mensagens (conversa_id, user_id, texto, arquivo_nome, arquivo_path, criado_em,
                                              responde_a, tipo, meta)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (cid, uid, texto, arquivo_nome, arquivo_path, agora(), id_resposta_valido(cid, responde_a),
                     tipo, json.dumps(meta, ensure_ascii=False) if meta else None))
    d.execute("UPDATE membros SET ultima_lida=? WHERE conversa_id=? AND user_id=?", (cur.lastrowid, cid, uid))
    d.commit()
    m = d.execute(SQL_MSG + " WHERE m.id=?", (cur.lastrowid,)).fetchone()
    payload = msg_dict(m)
    for i in membros_ids(cid):
        socketio.emit("mensagem", payload, to=f"u{i}")
    return payload


@app.post("/api/conversas/<int:cid>/arquivo")
@login_obrigatorio
def api_arquivo(cid):
    if not eh_membro(cid, g.user["id"]):
        abort(403)
    f = request.files.get("arquivo")
    if not f or not f.filename:
        return jsonify(erro="Nenhum arquivo enviado."), 400
    nome_original = f.filename
    ext = os.path.splitext(secure_filename(nome_original))[1].lower()
    nome_disco = f"{uuid.uuid4().hex}{ext}"
    f.save(os.path.join(UPLOAD_DIR, nome_disco))
    texto = (request.form.get("texto") or "").strip()
    return jsonify(gravar_e_enviar(cid, g.user["id"], texto, nome_original, nome_disco,
                                   responde_a=request.form.get("responde_a")))


# ---------------------------------------------------------------- mensagens de voz
TIPOS_AUDIO = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
               "audio/aac": ".aac", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav"}
MAX_AUDIO_MB = 15


@app.post("/api/conversas/<int:cid>/audio")
@login_obrigatorio
def api_audio(cid):
    if not eh_membro(cid, g.user["id"]):
        abort(403)
    f = request.files.get("audio")
    if not f:
        return jsonify(erro="Nenhum áudio recebido."), 400
    tipo_mime = (f.mimetype or "").split(";")[0].strip().lower()
    ext = TIPOS_AUDIO.get(tipo_mime)
    if not ext:
        return jsonify(erro="Formato de áudio não suportado."), 400
    dados = f.read()
    if len(dados) > MAX_AUDIO_MB * 1024 * 1024:
        return jsonify(erro=f"O áudio passa de {MAX_AUDIO_MB} MB."), 400
    if len(dados) < 200:
        return jsonify(erro="A gravação ficou vazia. Verifique o microfone."), 400
    try:
        duracao = max(0.0, min(float(request.form.get("duracao") or 0), 3600.0))
        picos = [max(0.0, min(float(x), 1.0)) for x in json.loads(request.form.get("picos") or "[]")][:64]
    except (ValueError, TypeError):
        duracao, picos = 0.0, []
    nome_disco = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, nome_disco), "wb") as out:
        out.write(dados)
    meta = {"duracao": round(duracao, 1), "picos": [round(x, 2) for x in picos], "mime": tipo_mime}
    return jsonify(gravar_e_enviar(cid, g.user["id"], "", f"Mensagem de voz{ext}", nome_disco,
                                   responde_a=request.form.get("responde_a"), tipo="audio", meta=meta))


# ---------------------------------------------------------------- reuniões (Teams / Meet)
PADROES_REUNIAO = {
    "teams": re.compile(r"^https://(teams\.microsoft\.com|teams\.live\.com|[a-z0-9-]+\.teams\.microsoft\.com)/\S+$", re.I),
    "meet": re.compile(r"^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?\S*)?$", re.I),
}


def plataforma_do_link(link):
    for nome, padrao in PADROES_REUNIAO.items():
        if padrao.match(link or ""):
            return nome
    return None


@app.post("/api/conversas/<int:cid>/reuniao")
@login_obrigatorio
def api_reuniao(cid):
    if not eh_membro(cid, g.user["id"]):
        abort(403)
    d = request.get_json() or {}
    link = (d.get("link") or "").strip()
    plataforma = plataforma_do_link(link)
    if not plataforma:
        return jsonify(erro="Cole um link válido do Microsoft Teams (teams.microsoft.com) "
                            "ou do Google Meet (meet.google.com/xxx-xxxx-xxx)."), 400
    titulo = (d.get("titulo") or "").strip()[:120] or "Reunião"
    agora_dt = datetime.now().replace(second=0, microsecond=0)
    if d.get("agora"):
        inicio, duracao = agora_dt, int(d.get("duracao") or 30)
    else:
        try:
            inicio = datetime.strptime(d.get("inicio") or "", "%Y-%m-%dT%H:%M")
        except ValueError:
            return jsonify(erro="Informe a data e a hora da reunião."), 400
        duracao = int(d.get("duracao") or 30)
        if inicio < agora_dt - timedelta(minutes=5):
            return jsonify(erro="A data da reunião já passou."), 400
    duracao = max(5, min(duracao, 600))
    fim = inicio + timedelta(minutes=duracao)
    meta = {"plataforma": plataforma, "link": link, "titulo": titulo, "agora": bool(d.get("agora")),
            "inicio": inicio.strftime("%Y-%m-%dT%H:%M"), "fim": fim.strftime("%Y-%m-%dT%H:%M"),
            "pauta": (d.get("pauta") or "").strip()[:1000]}
    return jsonify(gravar_e_enviar(cid, g.user["id"], titulo, tipo="reuniao", meta=meta))


@app.get("/api/reunioes")
@login_obrigatorio
def api_reunioes():
    """Reuniões das conversas do usuário: dos últimos 7 dias em diante."""
    limite = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M")
    rows = db().execute(SQL_MSG + """ JOIN membros mb ON mb.conversa_id = m.conversa_id AND mb.user_id = ?
        WHERE m.tipo='reuniao' AND m.apagada=0 ORDER BY m.id DESC LIMIT 500""", (g.user["id"],)).fetchall()
    lista = [msg_dict(m) for m in rows]
    lista = [r for r in lista if r["meta"] and r["meta"].get("fim", "") >= limite]
    lista.sort(key=lambda r: r["meta"]["inicio"])
    return jsonify(lista)


# ---------------------------------------------------------------- API admin
@app.route("/admin")
@admin_obrigatorio
def admin():
    return render_template("admin.html", me=user_publico(g.user), trocar_senha=bool(g.user["trocar_senha"]), pagina="admin")


@app.get("/api/admin/usuarios")
@admin_obrigatorio
def adm_listar():
    rows = db().execute("""SELECT u.*, (SELECT COUNT(*) FROM mensagens m WHERE m.user_id=u.id) AS total_msgs
                           FROM users u ORDER BY u.nome""").fetchall()
    out = []
    for u in rows:
        d = user_publico(u)
        d.update(ativo=bool(u["ativo"]), criado_em=u["criado_em"], ultimo_acesso=u["ultimo_acesso"],
                 total_msgs=u["total_msgs"])
        out.append(d)
    return jsonify(out)


@app.get("/api/admin/resumo")
@admin_obrigatorio
def adm_resumo():
    d = db()
    return jsonify(
        usuarios=d.execute("SELECT COUNT(*) FROM users WHERE ativo=1").fetchone()[0],
        online=len(online),
        mensagens=d.execute("SELECT COUNT(*) FROM mensagens").fetchone()[0],
        grupos=d.execute("SELECT COUNT(*) FROM conversas WHERE tipo='grupo'").fetchone()[0],
        hoje=d.execute("SELECT COUNT(*) FROM mensagens WHERE criado_em >= date('now','localtime')").fetchone()[0],
    )


@app.post("/api/admin/usuarios")
@admin_obrigatorio
def adm_criar():
    dados = request.get_json() or {}
    username = (dados.get("username") or "").strip().lower()
    nome = (dados.get("nome") or "").strip()
    senha = dados.get("senha") or ""
    if not username or not nome or len(senha) < 6:
        return jsonify(erro="Preencha usuário, nome e uma senha com ao menos 6 caracteres."), 400
    if db().execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
        return jsonify(erro="Esse nome de usuário já existe."), 400
    cor = CORES_AVATAR[db().execute("SELECT COUNT(*) FROM users").fetchone()[0] % len(CORES_AVATAR)]
    cur = db().execute("""INSERT INTO users (username, nome, cargo, unidade, senha_hash, is_admin, cor, criado_em)
                          VALUES (?,?,?,?,?,?,?,?)""",
                       (username, nome, dados.get("cargo", ""), dados.get("unidade", ""),
                        generate_password_hash(senha), 1 if dados.get("is_admin") else 0, cor, agora()))
    novo = cur.lastrowid
    geral = db().execute("SELECT id FROM conversas WHERE tipo='grupo' AND nome='Geral' ORDER BY id LIMIT 1").fetchone()
    if geral:
        db().execute("INSERT OR IGNORE INTO membros (conversa_id, user_id) VALUES (?,?)", (geral[0], novo))
    db().commit()
    socketio.emit("usuarios_mudaram", {})
    return jsonify(id=novo)


@app.put("/api/admin/usuarios/<int:uid>")
@admin_obrigatorio
def adm_editar(uid):
    dados = request.get_json() or {}
    u = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u:
        abort(404)
    if uid == g.user["id"] and (dados.get("ativo") is False or dados.get("is_admin") is False):
        return jsonify(erro="Você não pode remover o próprio acesso de administrador."), 400
    campos = {
        "nome": (dados.get("nome") or u["nome"]).strip(),
        "cargo": dados.get("cargo", u["cargo"]),
        "unidade": dados.get("unidade", u["unidade"]),
        "is_admin": 1 if dados.get("is_admin", bool(u["is_admin"])) else 0,
        "ativo": 1 if dados.get("ativo", bool(u["ativo"])) else 0,
    }
    db().execute("UPDATE users SET nome=:nome, cargo=:cargo, unidade=:unidade, is_admin=:is_admin, ativo=:ativo "
                 "WHERE id=:id", {**campos, "id": uid})
    if dados.get("senha"):
        if len(dados["senha"]) < 6:
            return jsonify(erro="A senha precisa ter ao menos 6 caracteres."), 400
        db().execute("UPDATE users SET senha_hash=?, trocar_senha=1 WHERE id=?",
                     (generate_password_hash(dados["senha"]), uid))
    db().commit()
    if not campos["ativo"]:
        socketio.emit("forcar_saida", {}, to=f"u{uid}")
    socketio.emit("usuarios_mudaram", {})
    return jsonify(ok=True)


@app.post("/api/admin/usuarios/<int:uid>/foto")
@admin_obrigatorio
def adm_foto(uid):
    if not db().execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
        abort(404)
    erro = salvar_foto(uid, request.files.get("foto"))
    if erro:
        return jsonify(erro=erro), 400
    socketio.emit("usuarios_mudaram", {})
    return jsonify(ok=True)


@app.delete("/api/admin/usuarios/<int:uid>/foto")
@admin_obrigatorio
def adm_remover_foto(uid):
    remover_arquivo_foto(uid)
    db().execute("UPDATE users SET foto=NULL WHERE id=?", (uid,))
    db().commit()
    avisar_foto(uid)
    socketio.emit("usuarios_mudaram", {})
    return jsonify(ok=True)


@app.delete("/api/admin/usuarios/<int:uid>")
@admin_obrigatorio
def adm_excluir(uid):
    if uid == g.user["id"]:
        return jsonify(erro="Você não pode excluir a si mesmo."), 400
    # as mensagens são preservadas no histórico: o usuário é apenas desativado e anonimizado
    db().execute("UPDATE users SET ativo=0, username=?, nome=nome||' (removido)' WHERE id=?",
                 (f"removido_{uid}_{uuid.uuid4().hex[:6]}", uid))
    db().execute("DELETE FROM membros WHERE user_id=?", (uid,))
    db().commit()
    socketio.emit("forcar_saida", {}, to=f"u{uid}")
    socketio.emit("usuarios_mudaram", {})
    return jsonify(ok=True)


@app.get("/api/admin/mensagens/<int:msg_id>/historico")
@admin_obrigatorio
def adm_historico(msg_id):
    d = db()
    m = d.execute(SQL_MSG + " WHERE m.id=?", (msg_id,)).fetchone()
    if not m:
        abort(404)
    versoes = d.execute("""SELECT v.*, u.nome FROM mensagens_versoes v JOIN users u ON u.id = v.feito_por
                           WHERE v.mensagem_id=? ORDER BY v.id""", (msg_id,)).fetchall()
    return jsonify(autor=m["nome"], enviada_em=m["criado_em"], atual=m["texto"], apagada=bool(m["apagada"]),
                   versoes=[{"acao": v["acao"], "texto": v["texto_anterior"], "por": v["nome"], "em": v["feito_em"]}
                            for v in versoes])


# ---------------------------------------------------------------- tempo real
@socketio.on("connect")
def ws_connect():
    uid = session.get("uid")
    if not uid:
        return False
    join_room(f"u{uid}")
    primeira = uid not in online
    online[uid] = online.get(uid, 0) + 1
    if primeira:
        socketio.emit("presenca", {"user_id": uid, "online": True})


@socketio.on("disconnect")
def ws_disconnect(*_):
    uid = session.get("uid")
    if not uid or uid not in online:
        return
    online[uid] -= 1
    if online[uid] <= 0:
        online.pop(uid, None)
        socketio.emit("presenca", {"user_id": uid, "online": False})


@socketio.on("enviar")
def ws_enviar(dados):
    uid = session.get("uid")
    cid = int(dados.get("conversa_id", 0))
    texto = (dados.get("texto") or "").strip()
    if not uid or not texto or not eh_membro(cid, uid):
        return {"ok": False}
    return {"ok": True, "msg": gravar_e_enviar(cid, uid, texto[:5000], responde_a=dados.get("responde_a"))}


def avisar_alteracao(msg_id, conv_id):
    novo = msg_dict(db().execute(SQL_MSG + " WHERE m.id=?", (msg_id,)).fetchone())
    novo["citacao_atualizada"] = citacao(msg_id)
    for i in membros_ids(conv_id):
        socketio.emit("mensagem_alterada", novo, to=f"u{i}")


@socketio.on("editar")
def ws_editar(dados):
    """Edita a própria mensagem a qualquer momento; a versão anterior fica guardada."""
    uid = session.get("uid")
    m = db().execute("SELECT * FROM mensagens WHERE id=?", (int(dados.get("id", 0)),)).fetchone()
    texto = (dados.get("texto") or "").strip()[:5000]
    if not m or m["user_id"] != uid or m["apagada"]:
        return {"ok": False, "erro": "Você só pode editar as suas mensagens."}
    if (m["tipo"] or "texto") != "texto":
        return {"ok": False, "erro": "Mensagens de voz e reuniões não podem ser editadas."}
    if not texto and not m["arquivo_path"]:
        return {"ok": False, "erro": "A mensagem não pode ficar vazia. Para remover, use “Apagar para todos”."}
    if texto == (m["texto"] or ""):
        return {"ok": True}
    d = db()
    d.execute("INSERT INTO mensagens_versoes (mensagem_id, acao, texto_anterior, feito_por, feito_em) VALUES (?,?,?,?,?)",
              (m["id"], "edicao", m["texto"], uid, agora()))
    d.execute("UPDATE mensagens SET texto=?, editada=1, editada_em=? WHERE id=?", (texto, agora(), m["id"]))
    d.commit()
    avisar_alteracao(m["id"], m["conversa_id"])
    return {"ok": True}


@socketio.on("apagar")
def ws_apagar(dados):
    """Apaga para todos os participantes, sem prazo. Autor ou administrador.
    Exclusão lógica: some da conversa, mas o conteúdo fica no banco para auditoria."""
    uid = session.get("uid")
    u = db().execute("SELECT is_admin FROM users WHERE id=?", (uid,)).fetchone()
    m = db().execute("SELECT * FROM mensagens WHERE id=?", (int(dados.get("id", 0)),)).fetchone()
    if not m or not u or m["apagada"] or (m["user_id"] != uid and not u["is_admin"]):
        return {"ok": False, "erro": "Você não pode apagar esta mensagem."}
    d = db()
    anterior = (m["texto"] or "") + (f"  [anexo: {m['arquivo_nome']}]" if m["arquivo_nome"] else "")
    d.execute("INSERT INTO mensagens_versoes (mensagem_id, acao, texto_anterior, feito_por, feito_em) VALUES (?,?,?,?,?)",
              (m["id"], "exclusao", anterior, uid, agora()))
    d.execute("UPDATE mensagens SET apagada=1, apagada_em=?, apagada_por=? WHERE id=?", (agora(), uid, m["id"]))
    d.commit()
    avisar_alteracao(m["id"], m["conversa_id"])
    return {"ok": True}


@socketio.on("digitando")
def ws_digitando(dados):
    uid = session.get("uid")
    cid = int(dados.get("conversa_id", 0))
    if not uid or not eh_membro(cid, uid):
        return
    u = db().execute("SELECT nome FROM users WHERE id=?", (uid,)).fetchone()
    for i in membros_ids(cid):
        if i != uid:
            socketio.emit("digitando", {"conversa_id": cid, "user_id": uid, "nome": u["nome"]}, to=f"u{i}")


# ---------- modo consulta (sem WebSocket) ----------
ACOES_HTTP = {"enviar": ws_enviar, "editar": ws_editar, "apagar": ws_apagar}


@app.post("/api/acao/<nome>")
@login_obrigatorio
def api_acao(nome):
    """Mesmas ações do Socket.IO, por HTTP, para quando não há conexão em tempo real."""
    f = ACOES_HTTP.get(nome)
    if not f:
        return jsonify(ok=True)
    return jsonify(f(request.get_json(silent=True) or {}))


@app.get("/api/novidades")
@login_obrigatorio
def api_novidades():
    """Mensagens novas (id > desde) e alteradas (editada/apagada desde 'alt') nas conversas do usuário."""
    uid = g.user["id"]
    d = db()
    resp = {"agora": agora(),
            "conversas": d.execute("SELECT COUNT(*) FROM membros WHERE user_id=?", (uid,)).fetchone()[0]}
    desde = request.args.get("desde", type=int)
    if desde is None:
        resp["ultimo_id"] = d.execute("SELECT COALESCE(MAX(id),0) FROM mensagens").fetchone()[0]
        return jsonify(resp)
    alt = request.args.get("alt", "")
    filtro = " JOIN membros mb ON mb.conversa_id = m.conversa_id AND mb.user_id = ?"
    novas = d.execute(SQL_MSG + filtro + " WHERE m.id > ? ORDER BY m.id LIMIT 200", (uid, desde)).fetchall()
    alteradas = d.execute(SQL_MSG + filtro + " WHERE m.id <= ? AND (m.editada_em >= ? OR m.apagada_em >= ?)",
                          (uid, desde, alt, alt)).fetchall()
    resp["ultimo_id"] = novas[-1]["id"] if novas else desde
    resp["novas"] = [msg_dict(m) for m in novas]
    resp["alteradas"] = [dict(msg_dict(m), citacao_atualizada=citacao(m["id"])) for m in alteradas]
    return jsonify(resp)


def certificado_https():
    """Gera (uma única vez) um certificado autoassinado para o chat rodar em https://.
    Navegadores só liberam o microfone (mensagens de voz) em páginas https ou no localhost."""
    pasta = os.path.join(BASE_DIR, "certificado")
    crt, key = os.path.join(pasta, "valorizacao-chat.crt"), os.path.join(pasta, "valorizacao-chat.key")
    if os.path.exists(crt) and os.path.exists(key):
        return crt, key
    try:
        import socket
        import ipaddress
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
    except ImportError:
        return None
    os.makedirs(pasta, exist_ok=True)
    nome_pc = socket.gethostname()
    ips = {"127.0.0.1"}
    try:
        ips.update(socket.gethostbyname_ex(nome_pc)[2])
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
            sk.connect(("10.255.255.255", 1))
            ips.add(sk.getsockname()[0])
    except OSError:
        pass
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Valorizacao Chat"),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Valorizacao Assessoria Contabil")])
    alt = [x509.DNSName("localhost"), x509.DNSName(nome_pc)] + \
          [x509.IPAddress(ipaddress.ip_address(i)) for i in sorted(ips)]
    from datetime import timezone
    agora_utc = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(nome).issuer_name(nome).public_key(chave.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(agora_utc - timedelta(days=1)).not_valid_after(agora_utc + timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName(alt), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(chave, hashes.SHA256()))
    with open(crt, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(key, "wb") as f:
        f.write(chave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                    serialization.NoEncryption()))
    print(f"Certificado HTTPS criado para: {', '.join(sorted(ips))} e {nome_pc}")
    return crt, key


def ip_da_rede():
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
            sk.connect(("10.255.255.255", 1))
            return sk.getsockname()[0]
    except OSError:
        return "IP-DESTE-COMPUTADOR"


def porta_livre(porta):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
        return sk.connect_ex(("127.0.0.1", porta)) != 0


if __name__ == "__main__":
    init_db()
    porta = int(os.environ.get("PORTA", 5080))
    if not porta_livre(porta):
        print(f"\n[ERRO] A porta {porta} já está sendo usada por outro programa neste computador.")
        print("       Abra o iniciar.bat no Bloco de Notas e troque o número em 'set PORTA=' (ex.: 5090).\n")
        raise SystemExit(1)
    opcoes = {}
    esquema = "http"
    host = os.environ.get("HOST", "0.0.0.0")
    if os.environ.get("PROXY") == "1":
        # Modo nuvem: um servidor web na frente (Caddy) cuida do HTTPS com certificado válido
        # e repassa as requisições para cá. Confia nos cabeçalhos X-Forwarded-* desse servidor.
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
        app.config["SESSION_COOKIE_SECURE"] = True
        host = os.environ.get("HOST", "127.0.0.1")
        print(f"\nValorização Chat (modo nuvem) ouvindo em http://{host}:{porta}, atrás do servidor web com HTTPS.\n")
        socketio.run(app, host=host, port=porta, allow_unsafe_werkzeug=True)
        raise SystemExit(0)
    if os.environ.get("HTTPS", "1") != "0":
        cert = certificado_https()
        if cert:
            opcoes["ssl_context"] = cert
            esquema = "https"
            app.config["SESSION_COOKIE_SECURE"] = True
        else:
            print("[AVISO] Pacote 'cryptography' ausente: rodando sem HTTPS (mensagens de voz ficam indisponíveis na rede).")
    print(f"\nValorização Chat rodando em {esquema}://localhost:{porta}")
    print(f"Nos outros computadores use: {esquema}://{ip_da_rede()}:{porta}")
    if esquema == "https":
        print("Na primeira vez o navegador avisa sobre o certificado: clique em 'Avançado' > 'Continuar'.")
    print()
    socketio.run(app, host=host, port=porta, allow_unsafe_werkzeug=True, **opcoes)
