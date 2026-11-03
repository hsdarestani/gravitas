import json
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from core.models import InteractiveLab, LabUsageVisit, LabUsageEvent, LabConversation, LabRunSnapshot


@override_settings(SECURE_SSL_REDIRECT=False)
class LabUsageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin = User.objects.create_superuser(username='usage-admin', email='admin@example.test', password='test')
        cls.member = User.objects.create_user(username='usage-member', first_name='Test', last_name='Researcher', email='member@example.test')
        cls.other = User.objects.create_user(username='other-member', email='other@example.test')
        cls.lab = InteractiveLab.objects.create(slug='science-universe', title='Science Ecosystem',
            status='published', studio_enabled=True, version=10, published_version=10, created_by=cls.admin,
            files=[{'name':'index.html','content':'<html><body>Lab</body></html>'}],
            published_files=[{'name':'index.html','content':'<html><body>Lab</body></html>'}],
            config={'components':['stage'],'pulsar_enabled':True},
            published_config={'components':['stage'],'pulsar_enabled':True})
        cls.second = InteractiveLab.objects.create(slug='other-lab', title='Other Lab',
            status='published', studio_enabled=True, version=1, published_version=1, created_by=cls.admin,
            published_files=cls.lab.published_files, published_config={'components':['stage']})

    def setUp(self):
        cache.clear()
        self.client.force_login(self.admin)
        self.client.get('/api/platform/bootstrap/')
        self.client.logout()
        self.client.cookies['gq_lab_analytics'] = '1'
        self.visit = str(uuid.uuid4())

    def send(self, events=None, active=0, client=None, visit=None, slug='science-universe'):
        return (client or self.client).post('/api/labs/'+slug+'/usage/', json.dumps({
            'visit': visit or self.visit, 'active_seconds': active,
            'events': events if events is not None else [self.event('opened')]}), content_type='application/json')

    def event(self, kind, **data):
        return {'id':str(uuid.uuid4()),'kind':kind,'data':data}

    def admin_get(self, suffix='', params=None):
        self.client.force_login(self.admin)
        return self.client.get('/api/platform/admin/labs/usage/'+suffix, params or {})

    def test_tracking_is_off_without_consent_and_rejection_prevents_future_writes(self):
        self.client.cookies['gq_lab_analytics'] = '0'
        self.assertEqual(self.send().json(), {'ok':True,'tracking':False})
        self.assertFalse(LabUsageVisit.objects.exists())
        self.assertNotIn('lab_usage_visitor', self.client.session)
        self.client.cookies['gq_lab_analytics'] = '1'
        self.assertEqual(self.send().status_code, 200)
        self.client.cookies['gq_lab_analytics'] = '0'
        self.send([self.event('comparison_created')])
        self.assertEqual(LabUsageEvent.objects.count(), 1)

    def test_batches_are_idempotent_bounded_and_do_not_store_personal_payloads(self):
        e = self.event('parameter_changed', parameter='verification', value=8, question='PRIVATE TEXT', email='private@example.test')
        for _ in range(2): self.assertEqual(self.send([e]).status_code, 200)
        visit = LabUsageVisit.objects.get(pk=self.visit)
        self.assertEqual(visit.policy_changes, 1)
        self.assertEqual(visit.event_count, 1)
        self.assertEqual(LabUsageEvent.objects.get().data, {'parameter':'verification','value':8})
        self.assertIsNone(visit.user_id)
        self.assertEqual(len(visit.visitor_key), 64)
        self.assertEqual(self.send([self.event('snapshot_saved')]).status_code, 400)
        self.assertEqual(self.send([self.event('opened')]*31).status_code, 400)
        self.assertEqual(LabUsageEvent.objects.count(), 1)

    def test_one_bad_event_rolls_back_the_entire_batch(self):
        response = self.send([self.event('opened'),self.event('pulsar_answered')])
        self.assertEqual(response.status_code, 400)
        self.assertFalse(LabUsageVisit.objects.exists())

    def test_visits_and_event_ids_cannot_be_attached_to_another_visitor(self):
        e = self.event('opened'); self.send([e])
        outsider=Client(); outsider.cookies['gq_lab_analytics']='1'
        self.assertEqual(self.send([self.event('comparison_created')], client=outsider).status_code, 409)
        self.assertEqual(self.send([e], client=outsider, visit=str(uuid.uuid4())).status_code, 409)
        self.assertEqual(LabUsageVisit.objects.count(), 1)
        self.assertEqual(LabUsageVisit.objects.get().comparisons, 0)

    def test_signed_in_identity_is_server_verified_and_guest_visit_can_continue_after_login(self):
        self.send()
        self.client.force_login(self.member)
        self.assertEqual(self.send([self.event('guide_test', step=1)]).status_code, 200)
        visit=LabUsageVisit.objects.get(pk=self.visit)
        self.assertEqual(visit.user_id,self.member.pk)
        self.assertEqual(visit.comparisons,1)
        self.assertEqual(visit.guide_tests,1)
        self.client.force_login(self.other)
        self.assertEqual(self.send([self.event('opened')]).status_code,409)
        visit.refresh_from_db();self.assertEqual(visit.user_id,self.member.pk)

    def test_active_time_is_monotonic_and_cannot_exceed_elapsed_server_time(self):
        self.send()
        LabUsageVisit.objects.filter(pk=self.visit).update(started_at=timezone.now()-timedelta(seconds=120))
        self.assertEqual(self.send([],active=9999).status_code,200)
        visit=LabUsageVisit.objects.get(pk=self.visit);self.assertGreaterEqual(visit.active_seconds,120);self.assertLessEqual(visit.active_seconds,121)
        self.send([],active=20);visit.refresh_from_db();self.assertGreaterEqual(visit.active_seconds,120)

    def test_cross_origin_tracking_is_rejected(self):
        response=self.client.post('/api/labs/science-universe/usage/', '{}', content_type='application/json', HTTP_ORIGIN='https://other.example')
        self.assertEqual(response.status_code,403);self.assertFalse(LabUsageVisit.objects.exists())

    def test_admin_permissions_apply_to_overview_details_saved_records_and_csv(self):
        self.send()
        for suffix in ('','visits/','visits/'+self.visit+'/','saved/','?format=csv'):
            url='/api/platform/admin/labs/usage/'+suffix
            self.assertEqual(self.client.get(url).status_code,401)
            self.client.force_login(self.member)
            self.assertEqual(self.client.get(url).status_code,403)
            self.client.logout()

    def test_analytics_group_accounts_across_labs_without_event_join_multiplication(self):
        self.client.force_login(self.member)
        self.send([self.event('opened'),self.event('comparison_created'),self.event('parameter_changed',parameter='funding',value=7)])
        self.send([self.event('guide_test',step=1),self.event('guide_completed')],visit=str(uuid.uuid4()),slug='other-lab')
        guest=Client();guest.cookies['gq_lab_analytics']='1'
        self.send(client=guest,visit=str(uuid.uuid4()))
        data=self.admin_get().json()
        self.assertEqual(data['summary']['sessions'],3)
        self.assertEqual(data['summary']['member_users'],1)
        self.assertEqual(data['summary']['guest_visitors'],1)
        self.assertEqual(data['summary']['comparisons'],2)
        members=[r for r in data['visitors']['items'] if r['user']]
        self.assertEqual(len(members),1);self.assertEqual(members[0]['sessions'],2);self.assertEqual(members[0]['labs'],2)
        self.assertEqual(members[0]['user']['email'],'member@example.test')
        visits=self.admin_get('visits/',{'visitor':'u:'+str(self.member.pk)}).json()['items']
        self.assertEqual(len(visits),2)
        events=self.admin_get('visits/'+self.visit+'/').json()['events']['items']
        self.assertEqual(len(events),3)
        filtered=self.admin_get(params={'lab':self.lab.pk,'audience':'members','q':'Researcher'}).json()
        self.assertEqual(filtered['summary']['sessions'],1)

    def test_date_filter_uses_tehran_day_boundaries(self):
        self.send()
        LabUsageVisit.objects.filter(pk=self.visit).update(started_at=datetime(2026,11,1,21,0,tzinfo=dt_timezone.utc))
        data=self.admin_get(params={'from':'2026-11-02','to':'2026-11-02','tz':'Asia/Tehran'}).json()
        self.assertEqual(data['summary']['sessions'],1)
        self.assertEqual(data['daily'][0]['day'],'2026-11-02')
        self.assertEqual(self.admin_get(params={'from':'bad-date'}).status_code,400)

    @patch('core.lab_api.configured',return_value=True)
    @patch('core.lab_api.run_text')
    def test_successful_pulsar_answers_are_recorded_server_side_without_question_text(self,run,configured):
        self.send()
        run.return_value=SimpleNamespace(provider='cloudflare',run_id='test',text='Compare both modeled outcomes.')
        response=self.client.post('/api/labs/science-universe/coach/',json.dumps({'event':'ask','question':'PRIVATE QUESTION','usage_visit':self.visit}),content_type='application/json')
        self.assertEqual(response.status_code,200,response.content)
        visit=LabUsageVisit.objects.get(pk=self.visit)
        self.assertEqual(visit.pulsar_questions,1);self.assertEqual(visit.pulsar_answers,1)
        events=list(visit.events.filter(provenance='server_confirmed').values('kind','data'))
        self.assertEqual(len(events),2);self.assertNotIn('PRIVATE QUESTION',json.dumps(events))

    def test_snapshot_counts_are_server_confirmed_and_idempotent(self):
        self.client.force_login(self.member);self.send()
        payload={'context':{'day':10,'world':'A','metrics':{'published':3}},'seed':21,'usage_visit':self.visit}
        for _ in range(2):
            r=self.client.post('/api/labs/science-universe/snapshots/',json.dumps(payload),content_type='application/json')
            self.assertIn(r.status_code,(200,201),r.content)
        visit=LabUsageVisit.objects.get(pk=self.visit)
        self.assertEqual(visit.snapshots,1)
        self.assertEqual(visit.events.filter(kind='snapshot_saved',provenance='server_confirmed').count(),1)

    def test_saved_user_records_show_counts_without_exposing_message_text(self):
        LabConversation.objects.create(lab=self.lab,owner=self.member,messages=[{'role':'user','text':'PRIVATE CHAT'},{'role':'pulsar','text':'PRIVATE ANSWER'}])
        LabRunSnapshot.objects.create(lab=self.lab,owner=self.member,signature='a'*64,payload={})
        r=self.admin_get('saved/')
        self.assertEqual(r.status_code,200,r.content)
        data=r.json()['items'][0]
        self.assertEqual(data['user']['id'],self.member.pk)
        self.assertEqual(data['saved_messages'],2);self.assertEqual(data['snapshots'],1)
        self.assertNotIn('PRIVATE CHAT',r.content.decode())

    def test_csv_export_is_filtered_and_spreadsheet_safe(self):
        self.member.first_name='=formula';self.member.last_name='';self.member.save()
        self.client.force_login(self.member);self.send()
        response=self.admin_get(params={'format':'csv','audience':'members'})
        self.assertEqual(response.status_code,200)
        text=b''.join(response.streaming_content).decode()
        self.assertIn("'=formula",text)
        self.assertIn('member@example.test',text)

    def test_learning_settings_are_managed_as_a_draft_until_published(self):
        self.client.force_login(self.admin)
        initial=self.client.get('/api/platform/admin/labs/'+str(self.lab.pk)+'/').json()['lab']
        self.assertTrue(initial['sync']['source_matches']);self.assertTrue(initial['sync']['settings_match'])
        settings=initial['config']['learning_workspace'];self.assertEqual(len(settings['lessons']),12)
        settings.update(guest_question_limit=3,lesson_days=7,auto_start_guide=False)
        settings['lessons']['verification']['question']='Which queue is limiting research?'
        config={**self.lab.config,'learning_workspace':settings}
        path='/api/platform/admin/labs/'+str(self.lab.pk)+'/'
        response=self.client.patch(path,json.dumps({'version':10,'config':config}),content_type='application/json')
        self.assertEqual(response.status_code,200,response.content)
        self.assertTrue(response.json()['lab']['sync']['unpublished_changes'])
        self.assertEqual(self.client.get('/api/labs/science-universe/access/').json()['limit'],25)
        published=self.client.post(path+'publish/',json.dumps({'version':response.json()['lab']['version']}),content_type='application/json')
        self.assertEqual(published.status_code,200,published.content)
        self.assertEqual(self.client.get('/api/labs/science-universe/access/').json()['limit'],3)
        public=self.client.get('/api/labs/').json()['labs']
        c=next(x for x in public if x['slug']=='science-universe')['config']['learning_workspace']
        self.assertEqual(c['lesson_days'],7);self.assertFalse(c['auto_start_guide'])
        self.assertEqual(c['lessons']['verification']['question'],'Which queue is limiting research?')
        self.client.logout()
        with patch('core.lab_api.configured',return_value=True), patch('core.lab_api.run_text',return_value=SimpleNamespace(provider='cloudflare',run_id='limit',text='Compare the same model days.')):
            for remaining in (2,1,0):
                answer=self.client.post('/api/labs/science-universe/coach/',json.dumps({'event':'ask','question':'Explain the queue.'}),content_type='application/json')
                self.assertEqual(answer.status_code,200,answer.content);self.assertEqual(answer.json()['access']['remaining'],remaining)
            blocked=self.client.post('/api/labs/science-universe/coach/',json.dumps({'event':'ask','question':'Another question.'}),content_type='application/json')
            self.assertEqual(blocked.status_code,401)

    def test_invalid_learning_settings_are_rejected(self):
        self.client.force_login(self.admin)
        for bad in ({'guest_question_limit':0},{'lesson_days':121},{'auto_start_guide':'yes'},{'lessons':{'made_up':{}}}):
            response=self.client.patch('/api/platform/admin/labs/'+str(self.lab.pk)+'/',json.dumps({'version':10,'config':{'components':['stage'],'learning_workspace':bad}}),content_type='application/json')
            self.assertEqual(response.status_code,400,response.content)
