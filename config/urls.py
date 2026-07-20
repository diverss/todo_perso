from django.contrib import admin
from django.urls import include, path, re_path
from tasks import views as task_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('sw.js', task_views.service_worker, name='service_worker'),
    path('manifest.json', task_views.manifest, name='manifest'),
    path('login/', task_views.login_view, name='login'),
    path('logout/', task_views.logout_view, name='logout'),
    re_path(r'^media/(?P<path>.*)$', task_views.protected_media, name='protected_media'),
    path('', include('tasks.urls')),
]
