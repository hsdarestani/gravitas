"""Regression coverage for production Tasks upstream availability."""
from pathlib import Path

from django.test import SimpleTestCase


class TasksGatewayDeployContractTests(SimpleTestCase):
    def test_workers_allow_parallel_slow_io_and_hot_reload_on_routine_deploy(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github' / 'workflows' / 'deploy.yml').read_text()
        self.assertIn('--worker-class gthread --workers 3 --threads 4 --timeout 60', workflow)
        self.assertIn('ExecReload=/bin/kill -HUP', workflow)
        self.assertIn('PROFILE_MARKER=', workflow)
        self.assertIn('sudo systemctl reload gravitas-backend.service', workflow)
        self.assertIn('sudo systemctl restart gravitas-backend.service', workflow)
        self.assertIn('proxy_connect_timeout 5s;', workflow)
        self.assertEqual(workflow.count('proxy_read_timeout 70s;'), 2)
        self.assertIn("test \"$backend_ready\" = 1", workflow)

    def test_production_operating_workflow_exercises_authenticated_task_board(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github' / 'workflows' / 'operating-production-e2e.yml').read_text()
        self.assertIn("request('/api/operating/task-board/')", workflow)
        self.assertIn("board_seconds < 20", workflow)
        self.assertIn('operating-task-board-latency', workflow)
