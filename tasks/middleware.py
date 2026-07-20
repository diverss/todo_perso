from urllib.parse import quote

from django.conf import settings
from django.shortcuts import redirect
from django.utils.cache import patch_vary_headers

# Chemins exemptés de l'authentification
_EXEMPT = ('/login/', '/sw.js', '/manifest.json', '/static/', '/admin/')


class LoginRequiredMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if any(request.path.startswith(p) for p in _EXEMPT):
            return self.get_response(request)

        if not request.user.is_authenticated:
            next_url = quote(request.get_full_path())
            return redirect(f'{settings.LOGIN_URL}?next={next_url}')

        response = self.get_response(request)
        patch_vary_headers(response, ['Cookie'])
        return response
