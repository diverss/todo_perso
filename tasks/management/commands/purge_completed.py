from django.core.management.base import BaseCommand
from tasks.models import Task, TaskImage


class Command(BaseCommand):
    help = 'Supprime toutes les tâches terminées (et leurs images) de la base de données'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Compter sans supprimer')

    def handle(self, *args, **options):
        qs = Task.objects.filter(completed=True)
        count = qs.count()
        img_count = TaskImage.objects.filter(task__in=qs).count()

        if options['dry_run']:
            self.stdout.write(f'{count} tâche(s) terminée(s) et {img_count} image(s) seraient supprimées.')
        else:
            # Supprimer les fichiers avant la suppression en cascade
            for img in TaskImage.objects.filter(task__in=qs):
                img.image.delete(save=False)
            qs.delete()
            self.stdout.write(self.style.SUCCESS(
                f'{count} tâche(s) et {img_count} image(s) supprimées.'
            ))
