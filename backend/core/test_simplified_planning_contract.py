from pathlib import Path

from django.test import SimpleTestCase


class SimplifiedPlanningContractTests(SimpleTestCase):
    @property
    def root(self):
        return Path(__file__).resolve().parents[2]

    def read(self, path):
        return (self.root / path).read_text(encoding='utf-8')

    def test_navigation_removes_initiatives_and_cycles(self):
        nav = self.read('assets/ws/ws-nav.js')
        planning = nav[nav.index("id: 'core-planning'"):nav.index("id: 'core-notes'")]
        self.assertIn("label: 'Planning'", planning)
        self.assertNotIn('op-initiatives', planning)
        self.assertNotIn('op-cycles', planning)
        self.assertNotIn("label: 'Initiatives'", planning)
        self.assertNotIn("label: 'Cycles'", planning)

    def test_planning_is_simple_okr_kr_milestone_dashboard(self):
        views = self.read('assets/ws/ws-views.js')
        start = views.index('export function renderCorePlanning')
        end = views.index('export function renderCoreTeam', start)
        planning = views[start:end]
        self.assertIn("'Objectives'", planning)
        self.assertIn("'Key Results'", planning)
        self.assertIn("'Open milestones'", planning)
        self.assertIn("panel('OKRs')", planning)
        self.assertIn("panel('Milestones')", planning)
        self.assertIn("Add KR", planning)
        self.assertIn("Add milestone", planning)
        self.assertNotIn("panel('Initiatives'", planning)
        self.assertNotIn("panel('Cycles'", planning)

    def test_task_board_uses_key_results_not_initiatives_or_cycles(self):
        views = self.read('assets/ws/ws-views.js')
        start = views.index('export function renderCoreTasks')
        end = views.index('export function renderCorePlanning', start)
        tasks = views[start:end]
        self.assertIn("field('Key result'", tasks)
        self.assertIn('key_result_id: Number(keyResult.value)', tasks)
        self.assertNotIn("field('Initiative'", tasks)
        self.assertNotIn("field('Cycle'", tasks)
        self.assertNotIn('cycle_id: cycle.value', tasks)

    def test_backend_exposes_planning_payload_and_internal_compatibility_container(self):
        dashboard = self.read('backend/core/operating_api_v4.py')
        base = self.read('backend/core/operating_api.py')
        self.assertIn("data['planning']", dashboard)
        self.assertIn("'objectives': objective_rows", dashboard)
        self.assertIn("'key_results':", dashboard)
        self.assertIn("'milestones':", dashboard)
        self.assertIn('def _execution_initiative_for_kr', base)
        self.assertIn('hidden from the simplified Planning surface', base)

    def test_open_task_export_exists(self):
        command = self.read('backend/core/management/commands/export_open_tasks.py')
        workflow = self.read('.github/workflows/export-open-tasks.yml')
        self.assertIn("exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])", command)
        self.assertIn("'objective': objective.title", command)
        self.assertIn("'key_result': kr.title", command)
        self.assertIn('open-tasks-production', workflow)
