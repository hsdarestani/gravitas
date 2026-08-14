from django.contrib.auth import get_user_model
from django.db import models
from django.test import TestCase
from django.urls import reverse

from .models import (
    AssetReference,
    ContentProduction,
    Project,
    ProjectMember,
    SectionAccess,
    StrategyDocument,
    Task,
    TeamMember,
)


User = get_user_model()


class HQV2Tests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='hq-admin',
            email='admin@example.com',
            password='test-password-123',
        )
        self.member = TeamMember.objects.create(
            user=self.admin,
            title='Founder',
            role_label='Founder / Admin',
        )
        for section, _ in SectionAccess.Section.choices:
            SectionAccess.objects.create(
                member=self.member,
                section=section,
                level=SectionAccess.Level.MANAGE,
            )

        self.project = Project.objects.create(
            name='Episode 01 — AI hypotheses',
            slug='episode-01-ai-hypotheses',
            kind=Project.Kind.CONTENT,
            status=Project.Status.ACTIVE,
            priority=Project.Priority.HIGH,
            owner=self.member,
        )
        self.task = Task.objects.create(
            project=self.project,
            title='Review evidence map',
            status=Task.Status.REVIEW,
            assignee=self.member,
        )
        self.production = ContentProduction.objects.create(
            project=self.project,
            working_title='Can AI generate a scientific hypothesis?',
            central_question='Can a machine form a scientific hypothesis?',
            stage=ContentProduction.Stage.SCIENTIFIC_REVIEW,
        )
        self.client.force_login(self.admin)

    def test_core_v2_pages_render(self):
        urls = [
            reverse('hq:dashboard'),
            reverse('hq:strategy'),
            reverse('hq:projects'),
            reverse('hq:project', args=[self.project.slug]),
            reverse('hq:content'),
            reverse('hq:content_edit', args=[self.production.pk]),
            reverse('hq:research'),
            reverse('hq:assets'),
            reverse('hq:team'),
            reverse('hq:search') + '?q=AI',
        ]
        for url in urls:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertContains(response, 'Gravitas HQ')

    def test_strategy_uses_external_master_roadmap(self):
        StrategyDocument.objects.create(
            title='Old copied roadmap',
            slug='gravitas-strategy-roadmap',
            kind=StrategyDocument.Kind.ROADMAP,
            status=StrategyDocument.Status.ACTIVE,
            body='This copy must not be presented as the master source.',
        )
        response = self.client.get(reverse('hq:strategy'))
        self.assertContains(response, 'https://gravitas-roadmap.pages.dev/')
        self.assertContains(response, 'Master strategy · source of truth')
        self.assertNotContains(response, 'Old copied roadmap')

    def test_every_major_section_has_contextual_guide(self):
        expected = {
            reverse('hq:dashboard'): 'How to use Overview',
            reverse('hq:strategy'): 'How Strategy works',
            reverse('hq:projects'): 'Projects & tasks',
            reverse('hq:project', args=[self.project.slug]): 'How to run this project',
            reverse('hq:content'): 'The Gravitas content pipeline',
            reverse('hq:content_edit', args=[self.production.pk]): 'How to work on this content piece',
            reverse('hq:research'): 'Research & evidence',
            reverse('hq:assets'): 'Asset storage policy',
            reverse('hq:team'): 'Roles, permissions and project access',
            reverse('hq:search') + '?q=AI': 'Using global search',
        }
        for url, copy in expected.items():
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertContains(response, copy)
                self.assertContains(response, 'data-help-open')

    def test_global_search_finds_authorized_work(self):
        response = self.client.get(reverse('hq:search'), {'q': 'AI'})
        self.assertContains(response, self.project.name)
        self.assertContains(response, self.production.working_title)

    def test_assets_are_reference_only_no_binary_field(self):
        forbidden = (models.FileField, models.ImageField)
        binary_fields = [
            field.name for field in AssetReference._meta.get_fields()
            if isinstance(field, forbidden)
        ]
        self.assertEqual(binary_fields, [])

    def test_read_only_member_sees_only_allowed_navigation_and_no_edit_actions(self):
        limited_user = User.objects.create_user(
            username='reviewer', email='reviewer@example.com', password='reviewer-password'
        )
        limited = TeamMember.objects.create(user=limited_user, role_label='Scientific Reviewer')
        SectionAccess.objects.create(
            member=limited,
            section=SectionAccess.Section.DASHBOARD,
            level=SectionAccess.Level.VIEW,
        )
        SectionAccess.objects.create(
            member=limited,
            section=SectionAccess.Section.PROJECTS,
            level=SectionAccess.Level.VIEW,
        )
        ProjectMember.objects.create(project=self.project, member=limited, role='Reviewer')
        self.client.force_login(limited_user)

        dashboard = self.client.get(reverse('hq:dashboard'))
        self.assertEqual(dashboard.status_code, 200)
        self.assertContains(dashboard, 'Projects & tasks')
        self.assertNotContains(dashboard, 'Content Studio</span>')
        self.assertNotContains(dashboard, 'Team & access')

        projects = self.client.get(reverse('hq:projects'))
        self.assertEqual(projects.status_code, 200)
        self.assertContains(projects, 'View only')
        self.assertNotContains(projects, 'Create project')

        detail = self.client.get(reverse('hq:project', args=[self.project.slug]))
        self.assertEqual(detail.status_code, 200)
        self.assertNotContains(detail, 'Start Content Studio')
        self.assertNotContains(detail, 'Open Content Studio')

        content = self.client.get(reverse('hq:content'))
        self.assertEqual(content.status_code, 403)
        team = self.client.get(reverse('hq:team'))
        self.assertEqual(team.status_code, 403)

    def test_search_does_not_leak_sections_without_permission(self):
        limited_user = User.objects.create_user(
            username='project-only', email='project-only@example.com', password='project-only-password'
        )
        limited = TeamMember.objects.create(user=limited_user, role_label='Project Contributor')
        SectionAccess.objects.create(member=limited, section=SectionAccess.Section.DASHBOARD, level=SectionAccess.Level.VIEW)
        SectionAccess.objects.create(member=limited, section=SectionAccess.Section.PROJECTS, level=SectionAccess.Level.VIEW)
        ProjectMember.objects.create(project=self.project, member=limited, role='Contributor')
        self.client.force_login(limited_user)

        response = self.client.get(reverse('hq:search'), {'q': 'AI'})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.project.name)
        self.assertNotContains(response, self.production.working_title)
        self.assertNotContains(response, '<h2>Content')
