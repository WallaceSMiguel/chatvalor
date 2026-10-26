@echo off
title Valorizacao Chat
cd /d "%~dp0"
rem Porta do chat. Se outro programa ja usa esta porta, troque o numero abaixo.
set PORTA=5080
rem HTTPS=1 libera o microfone (mensagens de voz). Use 0 para desligar.
set HTTPS=1
if not exist .venv (
  echo Criando ambiente Python...
  python -m venv .venv
)
echo Conferindo dependencias...
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements.txt
.venv\Scripts\python app.py
pause
