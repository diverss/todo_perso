Déploiement prod (fichiers actifs)
---------------------------------
apply-nginx.sh          Appliquer conf Nginx + HTTPS (sudo)
nginx/notgmail-app.conf Vhost HTTP→HTTPS + proxy Gunicorn
gunicorn.conf.py        Bind 127.0.0.1:8000
todo-perso.service      Unit systemd
.env.example            Variables d'environnement
nginx/TEMPLATE...       Nouveau sous-domaine app

Hors repo (serveur) :
  /home/edmond/todo_perso/.env
  /home/edmond/todo_perso/config/settings_local.py
  /etc/nginx/sites-available/notgmail-app
  systemd todo-perso.service

Archive (one-shot) : deploy/archive/
