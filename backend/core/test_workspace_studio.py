import uuid
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from .models import ResearchProject, WorkspaceMembership
from .operating_models import OperatingTask, OperatingTaskPredecessor, WorkStatus
from .platform_access import policy_for
from .platform_models import ObjectPolicy
from .platform_runtime_v3 import ensure_platform_workspaces


STUDIO = '/api/workspace-v2/'
BOARD = '/api/operating/task-board/'


@override_settings(WORKSPACE_STUDIO_ENABLED=True)
class WorkspaceStudioTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.admin = users.create_user('studio-admin@example.test')
        self.member = users.create_user('studio-member@example.test')
        self.external = users.create_user('studio-external@example.test')
        spaces = ensure_platform_workspaces(self.admin)
        self.workspace = spaces['core']
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.member)
        self.project = ResearchProject.objects.create(workspace=spaces['research'], owner=self.admin, title='Integration')
        self.client.force_login(self.admin)

    def task(self, title, **kwargs):
        return OperatingTask.objects.create(
            workspace=self.workspace, title=title, owner=self.admin, status=WorkStatus.READY,
            definition_of_done='Reviewed', **kwargs,
        )

    def state(self):
        response = self.client.get(STUDIO + 'state/')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def post(self, suffix, payload):
        return self.client.post(STUDIO + suffix, payload, content_type='application/json')

    def patch(self, task, payload):
        return self.client.patch(STUDIO + f'tasks/{task.pk}/', {
            **payload, 'expected_updated_at': task.updated_at.isoformat(),
        }, content_type='application/json')

    def test_shell_gate_and_core_authorization(self):
        self.assertContains(self.client.get('/workspace-v2'), '/assets/workspace-v2/workspace.js')
        with self.settings(WORKSPACE_STUDIO_ENABLED=False):
            self.assertEqual(self.client.get('/workspace-v2').status_code, 404)
            self.assertEqual(self.client.get(STUDIO + 'state/').status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(STUDIO + 'state/').status_code, 401)
        self.client.force_login(self.external)
        self.assertEqual(self.client.get(STUDIO + 'state/').status_code, 403)
        self.client.force_login(self.member)
        self.assertEqual(self.state()['actor']['id'], self.member.pk)
        self.assertEqual(self.client.get(STUDIO + 'state/?workspace_id=9989999').status_code, 403)

    def test_bidirectional_canonical_task_edits_and_stale_revision(self):
        created = self.post('tasks/', {
            'title':'V2 created', 'definition_of_done':'Reviewed', 'owner_id':self.admin.pk,
            'project_id':self.project.pk, 'status':'ready', 'duration_days':3,
            'client_create_id': str(uuid.uuid4()), 'checklist':['Verify'],
        })
        self.assertEqual(created.status_code, 201, created.content)
        task = OperatingTask.objects.get(pk=created.json()['id'])
        self.assertEqual(task.project_id, self.project.pk)
        self.assertEqual(task.studio_duration_days, 3)
        self.assertEqual(task.checklist_items.get().title, 'Verify')
        self.assertEqual(self.client.get(BOARD + f'{task.pk}/').json()['task']['title'], 'V2 created')
        response = self.client.patch(BOARD + f'{task.pk}/', {'title':'V1 edited'}, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(next(row['title'] for row in self.state()['tasks'] if row['id']==task.pk), 'V1 edited')
        self.assertEqual(self.patch(task, {'title':'Outdated overwrite'}).status_code, 409)
        task.refresh_from_db()
        response = self.patch(task, {'title':'V2 edited'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.client.get(BOARD + f'{task.pk}/').json()['task']['title'], 'V2 edited')

    def test_retried_create_and_csrf(self):
        payload = {
            'title':'One task', 'definition_of_done':'Reviewed', 'status':'ready',
            'client_create_id':str(uuid.uuid4()),
        }
        first = self.post('tasks/', payload)
        self.assertEqual(first.status_code, 201, first.content)
        replay = self.post('tasks/', payload)
        self.assertEqual(replay.json()['id'], first.json()['id'])
        self.assertTrue(replay.json()['replayed'])
        self.assertEqual(self.post('tasks/', {**payload, 'title':'Different content'}).status_code, 409)
        self.assertEqual(OperatingTask.objects.filter(title='One task').count(), 1)
        csrf = Client(enforce_csrf_checks=True)
        csrf.force_login(self.admin)
        self.assertEqual(csrf.post(STUDIO+'tasks/', payload, content_type='application/json').status_code, 403)
        token = csrf.get(STUDIO+'csrf/').json()['csrf_token']
        self.assertEqual(csrf.post(STUDIO+'tasks/', payload, content_type='application/json', HTTP_X_CSRFTOKEN=token).status_code, 200)

    def test_multiple_dependencies_merge_with_legacy_and_reject_cycles(self):
        first, second = self.task('First'), self.task('Second')
        target = self.task('Target', dependency=first)
        change = {'action':'add', 'task_id':target.pk, 'predecessor_id':second.pk}
        self.assertEqual(self.post('dependencies/', change).status_code, 200)
        self.assertEqual(self.post('dependencies/', change).status_code, 200)
        self.assertEqual(OperatingTaskPredecessor.objects.filter(task=target).count(), 1)
        actual = next(row for row in self.state()['tasks'] if row['id']==target.pk)
        self.assertEqual(set(actual['predecessor_ids']), {first.pk, second.pk})
        self.assertTrue(actual['blocked_by_dependency'])
        self.assertEqual(self.patch(target, {'status':'active'}).json()['error'], 'task_prerequisites_incomplete')
        v1_status = self.client.patch(BOARD + f'{target.pk}/', {'status':'active'}, content_type='application/json')
        self.assertEqual(v1_status.json()['error'], 'task_prerequisites_incomplete')
        third = self.task('Third')
        result = self.post('dependencies/', {'changes':[
            {'action':'add','task_id':third.pk,'predecessor_id':first.pk},
            {'action':'add','task_id':first.pk,'predecessor_id':target.pk},
        ]})
        self.assertEqual(result.json()['error'], 'dependency_cycle')
        self.assertFalse(OperatingTaskPredecessor.objects.filter(task=third).exists())
        v1_cycle = self.client.patch(BOARD + f'{second.pk}/', {'dependency_id':target.pk}, content_type='application/json')
        self.assertEqual(v1_cycle.status_code, 409)
        for predecessor in (first, second):
            predecessor.status = WorkStatus.DONE
            predecessor.save()
        self.assertEqual(self.patch(target, {'status':'active'}).status_code, 200)

    def test_private_predecessor_is_redacted_without_disabling_gate(self):
        hidden = self.task('Private prerequisite')
        policy_for(hidden, create=True, created_by=self.admin, default_visibility=ObjectPolicy.Visibility.PRIVATE)
        public = self.task('Visible follower', dependency=hidden)
        policy_for(public, create=True, created_by=self.admin, default_visibility=ObjectPolicy.Visibility.WORKSPACE)
        self.client.force_login(self.member)
        state = self.state()
        self.assertNotIn(hidden.pk, {row['id'] for row in state['tasks']})
        public_row = next(row for row in state['tasks'] if row['id']==public.pk)
        self.assertEqual(public_row['predecessor_ids'], [])
        self.assertTrue(public_row['blocked_by_dependency'])
        self.assertEqual(self.client.get(STUDIO+f'tasks/{hidden.pk}/details/').status_code, 404)

    def test_studio_workflow_and_comments_share_existing_rows(self):
        task = self.task('Needs QA')
        suffix = f'tasks/{task.pk}/'
        root = self.post(suffix+'comments/', {'body':'A note'})
        self.assertEqual(root.status_code, 201, root.content)
        reply = self.post(suffix+'comments/', {'body':'Reply', 'parent_id':root.json()['comment']['id']})
        self.assertEqual(reply.status_code, 201, reply.content)
        comments = self.client.get(f'/api/operating/tasks/{task.pk}/comments/').json()['comments']
        self.assertEqual(comments[1]['parent_id'], comments[0]['id'])
        attached = self.post(suffix+'workflow/', {'action':'install','workflow':{'template':'development'}})
        self.assertEqual(attached.status_code, 200, attached.content)
        self.assertEqual(attached.json()['workflow']['parts'][0]['iterations'][0]['number'], 1)
        canonical = self.client.get(f'/api/operating/tasks/{task.pk}/workflow/').json()['workflow']
        self.assertEqual({key: attached.json()['workflow'][key] for key in canonical}, canonical)
        task.refresh_from_db()
        completed = self.patch(task, {'status':'done'})
        self.assertEqual(completed.status_code, 409, completed.content)
        self.assertEqual(completed.json()['error'], 'workflow_approval_required')

    def test_canvas_round_trip_and_revision_protect_existing_project(self):
        task = self.task('Canvas task', project=self.project)
        url = STUDIO + f'projects/{self.project.pk}/canvas/'
        layout = {
            'positions':{str(task.pk):{'x':180,'y':210}}, 'groups':[], 'arrows':[],
            'frames':[{'id':'one','title':'Research','x':30,'y':60,'width':240,'height':190}],
            'start_date':'2026-11-25',
        }
        def save(revision, canvas):
            return self.client.patch(url, {'revision':revision, 'canvas':canvas}, content_type='application/json')
        response = save(0, layout)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(save(0, layout).status_code, 409)
        current = next(row for row in self.state()['projects'] if row['id']==self.project.pk)
        self.assertEqual(current['canvas'], layout)
        self.assertEqual(current['canvas_revision'], 1)
        invalid = {**layout,'positions':{'99999':{'x':1,'y':1}}}
        self.assertEqual(save(1, invalid).status_code, 400)
        self.project.title = 'Renamed from the existing model'
        self.project.save()
        self.assertEqual(self.project.studio_layout.revision, 1)

    def test_only_assigned_reviewer_can_approve_through_either_workspace(self):
        task = self.task('Assigned QA reviewer')
        suffix = f'tasks/{task.pk}/workflow/'
        initial = self.post(suffix, {'action':'install','workflow':{'template':'development'}}).json()['workflow']
        invalid = self.post(suffix, {'action':'assign_reviewers','revision':initial['revision'],'reviewers':{'1':self.external.pk}})
        self.assertEqual(invalid.status_code, 400, invalid.content)
        assignments = {'1':self.member.pk,'final':self.member.pk}
        changed = self.post(suffix, {'action':'assign_reviewers','revision':initial['revision'],'reviewers':assignments})
        self.assertEqual(changed.status_code, 200, changed.content)
        workflow = changed.json()['workflow']
        for step in workflow['steps']:
            response = self.post(suffix, {'action':'complete_step','revision':workflow['revision'],'step':step['id']})
            self.assertEqual(response.status_code, 200, response.content)
            workflow = response.json()['workflow']
        for part in workflow['parts']:
            draft = part['iterations'][0]
            response = self.post(suffix, {
                'action':'submit','revision':workflow['revision'],'part':part['id'],'iteration':1,
                'items':[{**row,'done':True} for row in draft['items']], 'preview':'https://example.test/preview',
            })
            self.assertEqual(response.status_code, 200, response.content)
            workflow = response.json()['workflow']
        approve = {'action':'approve','revision':workflow['revision'],'part':1,'iteration':1}
        canonical = '/api/operating/' + suffix
        self.assertEqual(self.client.post(canonical, approve, content_type='application/json').json()['error'],
                         'workflow_assigned_reviewer_required')
        self.client.force_login(self.member)
        for part in workflow['parts']:
            approved = self.post(suffix, {**approve,'revision':workflow['revision'],'part':part['id']})
            self.assertEqual(approved.status_code, 200, approved.content)
            workflow = approved.json()['workflow']
        self.assertEqual(workflow['assigned_reviewers'], assignments)
        final = {'action':'finalize','revision':workflow['revision']}
        self.client.force_login(self.admin)
        self.assertEqual(self.post(suffix, final).json()['error'], 'workflow_assigned_reviewer_required')
        self.client.force_login(self.member)
        self.assertEqual(self.post(suffix, final).status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.status, WorkStatus.DONE)

    def test_studio_attachment_bytes_and_read_permission(self):
        task = self.task('Attachment verification')
        suffix = f'tasks/{task.pk}/attachments/'
        blob = b'Workspace Studio attachment verification'
        with TemporaryDirectory() as uploads, self.settings(CORE_UPLOAD_ROOT=uploads):
            uploaded = self.client.post(STUDIO + suffix, {'file':SimpleUploadedFile('evidence.txt', blob)})
            self.assertEqual(uploaded.status_code, 201, uploaded.content)
            attachments = self.client.get(STUDIO + f'tasks/{task.pk}/details/').json()['attachments']
            download_url = attachments[0]['download_url']
            downloaded = self.client.get(download_url)
            self.assertEqual(downloaded.status_code, 200)
            self.assertEqual(b''.join(downloaded.streaming_content), blob)
            policy = policy_for(task, create=True, created_by=self.admin)
            policy.allow_download = False
            policy.save(update_fields=['allow_download'])
            self.assertEqual(self.client.get(download_url).status_code, 403)
            self.client.force_login(self.external)
            self.assertEqual(self.client.get(download_url).status_code, 403)

    def test_milestone_records_and_project_decisions_persist(self):
        task = self.task('Milestone evidence', project=self.project)
        milestone_path = f'projects/{self.project.pk}/milestones/'
        created = self.post(milestone_path, {
            'title':'QA evidence','owner_id':self.admin.pk,'due_date':'2026-12-02','task_ids':[task.pk],
        })
        self.assertEqual(created.status_code, 201, created.content)
        milestone_id = created.json()['id']
        row = next(item for item in self.state()['milestones'] if item['id'] == milestone_id)
        self.assertEqual(row['task_ids'], [task.pk])
        reached = self.client.patch(STUDIO + milestone_path + f'{milestone_id}/', {
            'completed':True,'expected_updated_at':row['updated_at'],
        }, content_type='application/json')
        self.assertEqual(reached.status_code, 200, reached.content)
        self.assertEqual(next(item for item in self.state()['milestones'] if item['id'] == milestone_id)['status'], 'done')
        project_path = STUDIO + f'projects/{self.project.pk}/'
        update = self.client.patch(project_path, {'action':'post_update','revision':0,'body':'Passed',
            'decision':'Accept evidence?','decider_id':self.admin.pk}, content_type='application/json')
        self.assertEqual(update.status_code, 200, update.content)
        project = next(row for row in self.state()['projects'] if row['id'] == self.project.pk)
        entry = project['updates'][0]
        resolved = self.client.patch(project_path, {'action':'resolve_decision','revision':project['revision'],
            'update_id':entry['id'],'body':'Accepted','outcome':'approved'}, content_type='application/json')
        self.assertEqual(resolved.status_code, 200, resolved.content)
        project = next(row for row in self.state()['projects'] if row['id'] == self.project.pk)
        self.assertEqual(project['updates'][0]['resolution']['outcome'], 'approved')

    def test_work_area_presets_and_team_members_use_canonical_records(self):
        created = self.post('areas/', {'action':'area','title':'Studio QA','owner_id':self.member.pk})
        self.assertEqual(created.status_code, 201, created.content)
        area_id = created.json()['id']
        self.client.force_login(self.member)
        saved = self.client.patch(STUDIO + f'areas/{area_id}/', {
            'action':'preset','name':'Browser pass','title':'Check desktop','checklist':['Open page'],'dod':['Record evidence'],
        }, content_type='application/json')
        self.assertEqual(saved.status_code, 200, saved.content)
        area = next(row for row in self.state()['areas'] if row['id'] == area_id)
        self.assertEqual(area['studio_task_presets'][0]['dod'], ['Record evidence'])
        self.assertEqual(self.post('members/', {'email':self.external.username,'role':'member'}).status_code, 403)
        self.client.force_login(self.admin)
        added = self.post('members/', {'email':self.external.username,'role':'member'})
        self.assertEqual(added.status_code, 201, added.content)
        self.assertEqual(self.post('members/', {'email':self.external.username,'role':'member'}).status_code, 409)
        self.client.force_login(self.external)
        self.assertEqual(self.state()['actor']['id'], self.external.pk)

    def test_source_template_materializes_a_real_workflow_and_okr_links(self):
        from .operating_models import KeyResult, StrategicObjective

        state = self.state()
        template = next(row for row in state['project_templates'] if row['id'] == 'gravitas-video')
        self.assertEqual(len(template['tasks']), 28)
        created = self.post('projects/', {'action':'create','title':'Video source template','owner_id':self.admin.pk,
            'start_date':'2026-11-28','template':template['id'],'duration':2})
        self.assertEqual(created.status_code, 201, created.content)
        project_id = created.json()['id']
        state = self.state()
        project = next(item for item in state['projects'] if item['id'] == project_id)
        self.assertEqual(OperatingTask.objects.filter(project_id=project_id).count(), 28)
        self.assertEqual(len(project['canvas']['loops']), 5)
        self.assertEqual(len(project['canvas']['frames']), 3)
        objective = StrategicObjective.objects.create(workspace=self.workspace, title='Quality', owner=self.admin)
        key_result = KeyResult.objects.create(objective=objective, title='Test coverage', owner=self.admin, target_value=10)
        result_path = STUDIO + f'results/{key_result.pk}/'
        for fields in ({'action':'check_in','value':5,'baseline':2,'note':'Five checks passed'},
                       {'action':'link','project_id':project_id}):
            response = self.client.patch(result_path, fields, content_type='application/json')
            self.assertEqual(response.status_code, 200, response.content)
        row = next(item for item in self.state()['objectives'] if item['id'] == objective.pk)['results'][0]
        self.assertEqual(row['checkins'][0]['value'], '5.0000')
        self.assertEqual(row['links'][0]['projectId'], str(project_id))

    def test_studio_private_task_shares_with_only_selected_members(self):
        third = get_user_model().objects.create_user('studio-third@example.test')
        WorkspaceMembership.objects.create(workspace=self.workspace, user=third)
        created = self.post('tasks/', {
            'title':'Private QA','definition_of_done':'Reviewed','status':'ready',
            'visibility':'private','allowed_members':[self.member.pk], 'client_create_id':str(uuid.uuid4()),
        })
        self.assertEqual(created.status_code, 201, created.content)
        task = OperatingTask.objects.get(pk=created.json()['id'])
        self.client.force_login(third)
        self.assertNotIn(task.pk, {row['id'] for row in self.state()['tasks']})
        self.assertEqual(self.client.get(STUDIO + f'tasks/{task.pk}/details/').status_code, 404)
        self.client.force_login(self.member)
        row = next(row for row in self.state()['tasks'] if row['id'] == task.pk)
        self.assertTrue(row['private'])
        self.assertFalse(row['can_edit'])
        self.client.force_login(self.admin)
        self.assertEqual(self.patch(task, {'visibility':'workspace'}).status_code, 200)
        self.client.force_login(third)
        self.assertIn(task.pk, {row['id'] for row in self.state()['tasks']})

    def test_calendar_notes_and_notebook_images_respect_ownership(self):
        day = '2026-11-25'
        note = self.post('calendar/notes/', {'date':day,'text':'Private note','visibility':'personal'})
        self.assertEqual(note.status_code, 201, note.content)
        image = b'\x89PNG\r\n\x1a\n'
        uploaded = self.client.post(STUDIO+'notebook/images/', {'date':day,'file':SimpleUploadedFile('evidence.png',image)})
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        image_id = uploaded.json()['id']
        saved = self.client.patch(STUDIO+'notebook/', {'date':day,'revision':0,
            'blocks':[{'id':image_id,'type':'image','filename':'evidence.png','caption':'Evidence'}]},
            content_type='application/json')
        self.assertEqual(saved.status_code, 200, saved.content)
        image_url = STUDIO+f'notebook/images/{image_id}/'
        self.assertEqual(self.client.get(image_url).content, image)
        self.client.force_login(self.member)
        self.assertEqual(self.state()['calendar_notes'], [])
        self.assertEqual(self.client.get(image_url).status_code, 404)
        pinned = self.post('calendar/notes/', {'date':day,'text':'Pin','visibility':'team','pinned':True})
        self.assertEqual(pinned.status_code, 403)

    def test_staff_only_scope_and_meeting_archive_use_the_same_record(self):
        from .operating_models import OperatingMeeting

        created = self.post('meetings/', {
            'title':'Review', 'date':'2026-11-25', 'time':'09:30', 'end':'10:30',
            'notes':'Finalize acceptance criteria', 'owner_id':self.admin.pk,
        })
        self.assertEqual(created.status_code, 201, created.content)
        ident = created.json()['meeting']['id']
        archived = self.client.patch(STUDIO + f'meetings/{ident}/', {'status':'done'}, content_type='application/json')
        self.assertEqual(archived.status_code, 200, archived.content)
        self.assertEqual(OperatingMeeting.objects.get(pk=ident).status, WorkStatus.DONE)
        self.assertEqual(self.client.get('/api/operating/meetings/').json()['meetings'][0]['id'], ident)

    def patch_studio(self, suffix, payload):
        return self.client.patch(STUDIO + suffix, payload, content_type='application/json')

    def test_project_lifecycle_requires_owner_report_and_preserves_project_identity(self):
        result = self.post('projects/', {
            'action':'create','title':'Studio lifecycle','owner_id':self.admin.pk,
            'start_date':'2026-11-30','kpis':[{'id':'one','label':'Coverage','target':'100%'}],
        })
        self.assertEqual(result.status_code, 201, result.content)
        project_id = result.json()['id']
        route = f'projects/{project_id}/'
        self.assertEqual(self.patch_studio(route, {'action':'done','revision':0}).status_code, 409)
        self.assertEqual(self.patch_studio(route, {'action':'report','revision':0,'body':'Accepted'}).status_code, 200)
        self.assertEqual(self.patch_studio(route, {'action':'done','revision':1}).status_code, 200)
        archived = next(row for row in self.state()['projects'] if row['id']==project_id)
        self.assertTrue(archived['archived'])
        self.assertEqual(archived['completions'][0]['body'],'Accepted')
        self.assertEqual(self.patch_studio(route, {'action':'reopen','revision':2}).status_code, 200)
        self.assertFalse(ResearchProject.objects.get(pk=project_id).archived)

    def test_idea_promotion_reuses_the_draft_project_and_work_area(self):
        from .operating_models import OperatingProcess

        process = OperatingProcess.objects.filter(workspace=self.workspace).first()
        if process is None:
            process = OperatingProcess.objects.create(workspace=self.workspace,key='technology',name='Technology',owner=self.admin)
        else:
            process.owner = self.admin
            process.save(update_fields=['owner'])
        response = self.post('ideas/', {'action':'create','title':'Idea draft','body':'An experiment'})
        self.assertEqual(response.status_code, 201, response.content)
        ids = response.json()
        route = f"ideas/{ids['id']}/"
        self.assertEqual(self.patch_studio(route, {'action':'refer','process_id':process.pk}).status_code, 200)
        response = self.patch_studio(route, {'action':'promote','title':'Experiment'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['project_id'], ids['project_id'])
        data = self.state()
        self.assertEqual(data['ideas'][0]['state'],'brought')
        self.assertEqual(next(p['process_id'] for p in data['projects'] if p['id']==ids['project_id']), process.pk)

    def test_notebook_preferences_project_notes_and_contributors_persist(self):
        body = {'date':'2026-11-30','revision':0,'blocks':[{'id':'entry','type':'text','text':'Private text'}]}
        self.assertEqual(self.patch_studio('notebook/',body).status_code, 200)
        self.assertEqual(self.patch_studio('notebook/',body).status_code, 409)
        preferences = {'showroom':{'signal:focus':'#987654'}}
        self.assertEqual(self.patch_studio('preferences/',preferences).status_code, 200)
        note = self.post(f'projects/{self.project.pk}/notes/', {'body':'Canonically attached note'})
        self.assertEqual(note.status_code, 201, note.content)
        task = self.task('Contributed')
        self.assertEqual(self.patch(task,{'contributor_ids':[self.member.pk]}).status_code, 200)
        state = self.state()
        self.assertEqual(state['notebooks'][0]['blocks'],body['blocks'])
        self.assertEqual(state['projects'][0]['notes'][0]['body'],'Canonically attached note')
        self.assertEqual(state['tasks'][0]['contributor_ids'],[self.member.pk])
        self.assertEqual(state['showroom_colors'],preferences['showroom'])
        self.client.force_login(self.member)
        self.assertFalse(self.state()['notebooks'])

    def test_named_canvas_restore_saves_backup_and_checks_revision(self):
        route = f'projects/{self.project.pk}/canvas/'
        geometry = {'positions':{},'frames':[],'groups':[],'arrows':[],'start_date':''}
        self.assertEqual(self.patch_studio(route,{'revision':0,'canvas':geometry}).status_code,200)
        snapshot = self.patch_studio(route,{'revision':1,'action':'version','name':'Baseline'}).json()
        moved = {**geometry,'frames':[{'id':'frame','title':'Plan','x':0,'y':0,'width':30,'height':50}]}
        self.assertEqual(self.patch_studio(route,{'revision':1,'canvas':moved}).status_code,200)
        restore = {'revision':2,'action':'restore','version_id':snapshot['id']}
        self.assertEqual(self.patch_studio(route,restore).status_code,200)
        self.assertEqual(self.patch_studio(route,restore).status_code,409)
        data = self.state()['projects'][0]
        self.assertFalse(data['canvas']['frames'])
        self.assertEqual(len(data['canvas_versions']),2)

    def test_nested_project_and_review_loop_gate_real_task_status(self):
        child = ResearchProject.objects.create(workspace=self.project.workspace, owner=self.admin, title='Child project')
        review = self.task('Review delivery', project=self.project, studio_duration_days=2)
        node_id = 'project-link-review'
        canvas = {'positions':{},'frames':[],'groups':[],'arrows':[],'start_date':'',
                  'nodes':[{'id':node_id,'targetProjectId':str(child.pk),'milestoneId':'','x':190,'y':160}],
                  'handoffs':[[node_id,str(review.pk)]],
                  'loops':[{'id':'round','from':str(review.pk),'to':str(review.pk),'target':1,'count':0,'optional':False}]}
        saved = self.patch_studio(f'projects/{self.project.pk}/canvas/', {'revision':0,'canvas':canvas})
        self.assertEqual(saved.status_code, 200, saved.content)
        blocked = self.patch(review, {'status':'active'})
        self.assertEqual(blocked.json()['error'], 'project_handoff_incomplete')
        child.archived = True
        child.save(update_fields=['archived'])
        self.assertEqual(self.patch(review, {'status':'active'}).status_code, 200)
        review.refresh_from_db()
        blocked = self.patch(review, {'status':'done'})
        self.assertEqual(blocked.json()['error'], 'review_pass_required')
        result = self.post(f'projects/{self.project.pk}/review/', {'revision':1,'id':'round','findings':'Resolved.'})
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(self.project.studio_layout.canvas['loops'][0]['count'], 1)

    def test_weekly_meeting_creates_one_canonical_session_when_edited(self):
        response = self.post('meetings/',{
            'title':'Weekly planning','date':'2026-11-30','time':'09:00','end':'10:00',
            'owner_id':self.admin.pk,'repeat':'weekly','agenda':['Review open work'],
        })
        self.assertEqual(response.status_code,201,response.content)
        series = self.state()['meeting_series'][0]
        key = f"weekly:{series['id']}:2026-12-07"
        route = f'meetings/{key}/'
        response = self.patch_studio(route,{'agenda_action':'check','agenda_index':0,'agenda_text':'Review open work'})
        self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(self.patch_studio(route,{'agenda_action':'add','agenda_text':'Next'}).status_code,200)
        matching = [row for row in self.state()['meetings'] if row['id']==key]
        self.assertEqual(len(matching),1)
        self.assertTrue(matching[0]['agenda'][0]['done'])
