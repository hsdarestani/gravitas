from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from hq.models import (
    ContentProduction,
    Objective,
    Project,
    SectionAccess,
    StrategyDocument,
    TeamMember,
)


ROADMAP_BODY = """# Gravitas Strategy & Roadmap

## What Gravitas is
Gravitas is a media + lab + community project around science, philosophy, society and AI/ML.

The operating loop is:

Watch → Question → Test → Contribute → Return

The website is where Gravitas deepens. It is not just a video archive: it holds sources, companion articles, dossiers, diagrams, simulations, interactive labs, comments, learning paths and community discussion.

## Language
English is the primary and canonical content language. German, Persian and other localized editions are added according to audience need, topic and production capacity.

## Starting wedge
AI × Research — especially how AI/ML changes scientific research, the quality of scientific reasoning, limitations, consequences and deeper scientific questions.

This is not a prompt-tips or tool-list channel.

## Distribution and programs
YouTube is the main discovery and trust engine.

Core formats:
- Narrative long-form
- Native Shorts
- Science-in-the-making / news
- Interviews
- Gravitas Lab
- Gravitas Table

## Website spaces
- Magazine
- Dossiers
- Interactive Lab
- Newsletter
- Learning Paths
- Community

## Signature interaction
Lightweight browser scientific games and experiments should become a recognizable Gravitas signature.

Examples include Hypothesis Machine, News vs Media Hype, Science Budget, Tune the Universe, Reviewer game and Weekly Thought Experiment.

## North Star
Month 6 target: 500 Monthly Empowered Participants (MEP).

An empowered participant does more than consume: they test, contribute, discuss, learn or create something measurable inside the Gravitas ecosystem.

## Six-month execution targets
- 12 long-form videos
- 36 Shorts, with at least 18 native Shorts
- 6 site dossiers / companion articles
- 6 newsletters
- 2 interactive experiences
- 1,500 newsletter subscribers
- 300 registered users
- 100 monthly active members
- 250 meaningful contributions
- ≥20% 30-day return rate
- 12 qualified commercial/institutional proposals
- ≥3 paid projects
- ≥€15k revenue / contracted value
- 50 paid beta members when membership is tested

## Publishing cadence
- Tuesday: Short
- Every second Thursday: long-form
- Friday: connected Short + question
- Last Sunday of month: Newsletter
- Monday: review and planning

## Production workflow
Topic Score → Content Brief → Evidence Map → Script → Scientific Review → Production → Companion Page → Distribution → Post-mortem

## First-release sprint
Initial focus: “Can AI generate a scientific hypothesis?”

The first release should exercise the full loop: long-form / dossier / Hypothesis Machine / community question / newsletter / Shorts / post-mortem.

## Operating principle
Do not optimize for content volume alone. Optimize for capability: better questions, better evidence, better experiments, meaningful contributions and return behavior.
"""


class Command(BaseCommand):
    help = 'Bootstrap Gravitas HQ with founder access, living roadmap, core objectives and initial projects.'

    def handle(self, *args, **options):
        User = get_user_model()
        superusers = User.objects.filter(is_superuser=True, is_active=True)
        for user in superusers:
            member, _ = TeamMember.objects.get_or_create(
                user=user,
                defaults={'title': 'Founder / Administrator', 'role_label': 'Founder / Admin', 'status': TeamMember.Status.ACTIVE},
            )
            changed = False
            if member.status != TeamMember.Status.ACTIVE:
                member.status = TeamMember.Status.ACTIVE
                changed = True
            if not member.role_label:
                member.role_label = 'Founder / Admin'
                changed = True
            if changed:
                member.save()
            for section, _ in SectionAccess.Section.choices:
                SectionAccess.objects.update_or_create(
                    member=member,
                    section=section,
                    defaults={'level': SectionAccess.Level.MANAGE},
                )

        founder = TeamMember.objects.filter(user__is_superuser=True, status=TeamMember.Status.ACTIVE).first()

        roadmap, created = StrategyDocument.objects.update_or_create(
            slug='gravitas-strategy-roadmap',
            defaults={
                'title': 'Gravitas Strategy & Roadmap — 6 Month Operating Plan',
                'kind': StrategyDocument.Kind.ROADMAP,
                'status': StrategyDocument.Status.ACTIVE,
                'summary': 'Living strategy document connecting the Gravitas mission, operating loop, content thesis, six-month targets and execution cadence.',
                'body': ROADMAP_BODY,
                'owner': founder,
                'updated_by': founder,
            },
        )

        mep, _ = Objective.objects.update_or_create(
            title='Reach 500 Monthly Empowered Participants',
            defaults={
                'description': 'Build a repeatable Watch → Question → Test → Contribute → Return loop and reach 500 MEP by month six.',
                'status': Objective.Status.ACTIVE,
                'owner': founder,
                'strategy_document': roadmap,
                'target_date': timezone.localdate() + timedelta(days=180),
                'metric_name': 'Monthly Empowered Participants',
                'target_value': 500,
                'current_value': 0,
            },
        )

        hq_project, _ = Project.objects.update_or_create(
            slug='gravitas-hq-v1',
            defaults={
                'name': 'Gravitas HQ V1',
                'kind': Project.Kind.PRODUCT,
                'status': Project.Status.ACTIVE,
                'priority': Project.Priority.HIGH,
                'description': 'Internal operating system: strategy, projects/tasks, content production, evidence, external assets and granular team access.',
                'objective': mep,
                'owner': founder,
                'start_date': timezone.localdate(),
            },
        )

        episode, _ = Project.objects.update_or_create(
            slug='episode-01-ai-scientific-hypothesis',
            defaults={
                'name': 'Episode 01 — Can AI generate a scientific hypothesis?',
                'kind': Project.Kind.CONTENT,
                'status': Project.Status.PLANNED,
                'priority': Project.Priority.HIGH,
                'description': 'First full Gravitas content loop: video, dossier, Hypothesis Machine, community discussion, newsletter and Shorts.',
                'objective': mep,
                'owner': founder,
                'due_date': timezone.localdate() + timedelta(days=14),
            },
        )
        ContentProduction.objects.update_or_create(
            project=episode,
            defaults={
                'working_title': 'Can AI generate a scientific hypothesis?',
                'central_question': 'Can a machine form a scientific hypothesis, or only generate a sentence that looks like one?',
                'stage': ContentProduction.Stage.IDEA,
                'planned_publish_at': timezone.now() + timedelta(days=14),
            },
        )

        self.stdout.write(self.style.SUCCESS(
            f'HQ bootstrap complete. Roadmap={"created" if created else "updated"}; founder={founder or "none"}; project={hq_project.slug}'
        ))
