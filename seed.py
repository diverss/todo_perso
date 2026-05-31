import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from tasks.models import Label, Project, Section, Task

Label.objects.all().delete()
Project.objects.all().delete()

# Labels
work = Label.objects.create(name='Travail', color='#5b8def', order=0)
perso = Label.objects.create(name='Perso', color='#299438', order=1)
urgent = Label.objects.create(name='Urgent', color='#db4035', order=2)

# Project 1
p1 = Project.objects.create(name='Maison', color='#299438', order=0)
s1 = Section.objects.create(name='Courses', project=p1, order=0)
s2 = Section.objects.create(name='Bricolage', project=p1, order=1)

t1 = Task.objects.create(title='Acheter du pain', project=p1, section=s1, label=perso, priority=4, order=0)
t2 = Task.objects.create(title='Réparer la fenêtre', project=p1, section=s2, priority=1, order=0)
Task.objects.create(title='Acheter les vis', project=p1, section=s2, parent=t2, priority=3, order=0)
Task.objects.create(title='Poncer le cadre', project=p1, section=s2, parent=t2, priority=4, order=1)
Task.objects.create(title='Plantes pour le balcon', project=p1, section=s1, label=perso, priority=4, order=1)

# Project 2
p2 = Project.objects.create(name='Projets perso', color='#a44bb3', order=1)
s3 = Section.objects.create(name='Dev', project=p2, order=0)
s4 = Section.objects.create(name='Lectures', project=p2, order=1)

Task.objects.create(title='Finir l\'app Todo', project=p2, section=s3, label=work, priority=2, order=0)
Task.objects.create(title='Lire Clean Code', project=p2, section=s4, label=perso, priority=3, order=0)
Task.objects.create(title='Lire The Pragmatic Programmer', project=p2, section=s4, priority=4, order=1)

# Project 3
p3 = Project.objects.create(name='Travail', color='#ff9933', order=2)
Task.objects.create(title='Préparer la réunion lundi', project=p3, label=urgent, priority=1, order=0)
Task.objects.create(title='Envoyer le rapport Q2', project=p3, label=work, priority=2, order=1)
Task.objects.create(title='Mettre à jour la doc API', project=p3, label=work, priority=3, order=2)

print("Données de démo insérées !")
