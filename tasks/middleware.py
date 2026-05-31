from django.conf import settings
from django.shortcuts import redirect

# Chemins exemptés de l'authentification
_EXEMPT = ('/login/', '/logout/', '/sw.js', '/manifest.json', '/static/', '/media/', '/admin/')


class TokenAuthMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if any(request.path.startswith(p) for p in _EXEMPT):
            return self.get_response(request)

        if request.COOKIES.get('access_token') != settings.ACCESS_TOKEN:
            return redirect(f'/login/?next={request.path}')

        return self.get_response(request)
