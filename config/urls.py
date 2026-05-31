from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from tasks import views as task_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('sw.js', task_views.service_worker, name='service_worker'),
    path('manifest.json', task_views.manifest, name='manifest'),
    path('login/', task_views.login_view, name='login'),
    path('logout/', task_views.logout_view, name='logout'),
    path('', include('tasks.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
