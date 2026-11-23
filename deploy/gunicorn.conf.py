"""Gunicorn configuration for todo_perso (notgmail.fr)."""

import multiprocessing
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Derrière nginx uniquement
bind = "127.0.0.1:8000"
# VPS petit : éviter trop de workers (chaque process charge Django + PG)
workers = min(3, max(2, multiprocessing.cpu_count() + 1))
worker_class = "sync"
timeout = 120
keepalive = 5

# IMPORTANT: ne pas précharger l'app avant le fork avec PostgreSQL.
# Sinon les workers héritent de connexions DB cassées → 502 aléatoires après login.
preload_app = False

# Recycle workers pour éviter fuites / connexions PG mortes
max_requests = 500
max_requests_jitter = 50

accesslog = str(BASE_DIR / "logs" / "gunicorn-access.log")
errorlog = str(BASE_DIR / "logs" / "gunicorn-error.log")
loglevel = "info"
capture_output = True

proc_name = "todo_perso"
umask = 0o007


def post_fork(server, worker):
    """Ferme toute connexion DB héritée après le fork (sécurité)."""
    try:
        import django
        if django.apps.apps.ready:
            from django.db import connections
            connections.close_all()
    except Exception:
        pass
