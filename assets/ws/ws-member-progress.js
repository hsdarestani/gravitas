import * as P from './ws-platform.js?v=20260914-7';
import * as C from './ws-charts.js?v=20260919-charts2';

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function doc(host, title, subtitle = '') {
  host.innerHTML = '';
  const wrap = el('div', 'ws-doc ws-doc--wide fl-doc');
  const head = el('header', 'ws-doc__head fl-head');
  head.append(el('h1', 'ws-doc__title', title));
  if (subtitle) head.append(el('p', 'ws-doc__meta', subtitle));
  wrap.append(head);
  host.append(wrap);
  return wrap;
}

function loading(host) {
  const wrap = doc(host, 'Progress');
  const skeleton = el('div', 'fl-skeleton-grid');
  for (let i = 0; i < 6; i += 1) skeleton.append(el('div', 'fl-skeleton'));
  wrap.append(skeleton);
}

function tagStrip(items = []) {
  const values = items.filter(Boolean);
  if (!values.length) return null;
  const strip = el('div', 'fl-badges');
  values.forEach((item) => strip.append(el('span', 'v-badge fl-badge', item)));
  return strip;
}

function detailItem({
  title,
  meta = '',
  body = '',
  tags = [],
  percent = null,
  onClick = null,
  icon = 'target',
  series = '',
}) {
  const node = C.listItem({ title, meta, icon, series, onClick });
  const main = node.querySelector('.wc-item__main');
  if (body) main?.append(el('p', 'fl-row__body', body));
  const badges = tagStrip(tags);
  if (badges) main?.append(badges);
  if (percent != null) main?.append(C.meter(percent, `${Math.round(Number(percent) || 0)}%`));
  return node;
}

function emptyLine(text) {
  return C.note(text);
}

function dashboardCard(title, note, span) {
  return C.card({ title, note, span });
}

export async function renderMemberProgress(host, { go }) {
  loading(host);
  try {
    const data = await P.memberDashboard();
    const wrap = doc(
      host,
      'Progress',
      'Your public learning paths, LMS courses and research participation in one account view.',
    );

    const layout = C.bento();

    const tiles = [
      C.statTile({
        value: data.topic_progress?.total || 0,
        label: 'Topics tracked',
        icon: 'target',
        note: data.topic_progress?.completed ? `${data.topic_progress.completed} completed` : 'Public topics',
        featured: true,
      }),
      C.statTile({
        value: data.topic_progress?.completed || 0,
        label: 'Topics completed',
        icon: 'activity',
        note: 'Finished topics',
      }),
      C.statTile({
        value: data.public_paths?.in_progress || 0,
        label: 'Public paths',
        icon: 'planning',
        note: 'In progress',
      }),
    ];

    if (data.learning?.access) {
      tiles.push(
        C.statTile({
          value: data.learning?.active || 0,
          label: 'Courses active',
          icon: 'content',
          note: 'LMS',
          onClick: () => go('/workspace/learning/my'),
        }),
        C.statTile({
          value: data.learning?.completed || 0,
          label: 'Courses completed',
          icon: 'notes',
          note: 'LMS',
          onClick: () => go('/workspace/learning/certificates'),
        }),
      );
    }

    if (data.research?.access) {
      tiles.push(C.statTile({
        value: data.research?.projects || 0,
        label: 'Research projects',
        icon: 'projects',
        note: 'Owned or joined',
        onClick: () => go('/workspace/research'),
      }));
    }

    const tileSpan = tiles.length >= 6 ? '2' : tiles.length === 4 ? '3' : '4';
    tiles.forEach((tile, index) => {
      tile.dataset.span = tileSpan;
      tile.dataset.series = String((index % 5) + 1);
    });
    layout.append(...tiles);

    const topicGauge = C.card({
      title: 'Topic completion',
      note: 'Completion across the public Topics you started.',
      span: 4,
    });
    topicGauge.body.append(C.gauge({
      value: data.topic_progress?.completed || 0,
      total: data.topic_progress?.total || 0,
      label: 'complete',
      caption: `${data.topic_progress?.completed || 0} of ${data.topic_progress?.total || 0} Topics completed`,
      empty: 'No Topic progress yet',
    }));
    layout.append(topicGauge.box);

    const mix = C.card({
      title: 'Account activity mix',
      note: 'A quick view of what is currently active across your layers.',
      span: 8,
    });
    mix.body.append(C.barRows([
      { label: 'Topics', value: data.topic_progress?.total || 0, series: '1' },
      { label: 'Public paths', value: data.public_paths?.in_progress || 0, series: '2' },
      { label: 'Courses', value: data.learning?.active || 0, series: '3' },
      { label: 'Research', value: data.research?.projects || 0, series: '4' },
    ], { scaffold: true }));
    layout.append(mix.box);

    const topics = dashboardCard(
      'Topic progress',
      'Only published Topic activities count: video, discussion, vote and simulation.',
      6,
    );
    const topicItems = data.topic_progress?.items || [];
    if (!topicItems.length) {
      topics.body.append(emptyLine('No topic progress yet. Open a Topic and interact with its published components.'));
    } else {
      const rows = [];
      for (const item of topicItems) {
        const completed = Object.entries(item.applicable || {})
          .filter(([, enabled]) => enabled)
          .map(([key]) => {
            const labels = { video: 'Video', comment: 'Discussion', vote: 'Vote', simulation: 'Simulation' };
            return `${item.done?.[key] ? '✓' : '○'} ${labels[key] || key}`;
          });
        rows.push(detailItem({
          title: item.title,
          meta: `${item.done_count} of ${item.total} activities`,
          tags: [...completed, item.completed ? 'Completed' : 'In progress'],
          percent: item.progress_percent,
          icon: 'target',
          series: '1',
          onClick: () => { if (item.url) location.href = item.url; },
        }));
      }
      topics.body.append(C.list(rows));
    }
    layout.append(topics.box);

    const publicPaths = dashboardCard(
      'Public learning paths',
      'Progress from the public Gravitas+ site follows the same account here.',
      6,
    );
    const paths = data.public_paths?.items || [];
    if (!paths.length) {
      publicPaths.body.append(emptyLine('No public path progress yet. Complete a public learning step to start tracking.'));
    } else {
      publicPaths.body.append(C.list(paths.map((item) => detailItem({
        title: item.title,
        meta: `${item.done_count} of ${item.total} steps`,
        tags: [item.completed ? 'Completed' : 'In progress'],
        percent: item.progress_percent,
        icon: 'planning',
        series: '2',
        onClick: () => { if (item.url) location.href = item.url; },
      }))));
    }
    layout.append(publicPaths.box);

    if (data.learning?.access) {
      const learning = dashboardCard('LMS learning', 'Course progress and certificates.', 6);
      const enrollments = data.learning?.enrollments || [];
      if (!enrollments.length) {
        learning.body.append(emptyLine('No course progress yet. Enroll in a course to start tracking it.'));
      } else {
        learning.body.append(C.list(enrollments.map((item) => detailItem({
          title: item.course_title,
          meta: P.meta([P.label(item.status), item.completed_at ? `Completed ${P.formatDate(item.completed_at)}` : '']),
          tags: [item.certificate?.valid ? 'Certificate' : ''],
          percent: item.progress_percent,
          icon: 'content',
          series: '3',
          onClick: () => go(`/workspace/learning/courses/${item.course_id}`),
        }))));
      }
      layout.append(learning.box);
    }

    if (data.research?.access) {
      const research = dashboardCard('Research participation', 'Project-level access stays authoritative.', 6);
      const projects = data.research?.recent || [];
      if (!projects.length) {
        research.body.append(emptyLine('No research projects yet. Projects you join will appear here.'));
      } else {
        research.body.append(C.list(projects.map((item) => detailItem({
          title: item.title,
          meta: P.meta([
            P.label(item.role),
            P.label(item.status),
            item.deadline ? `Due ${P.formatDate(item.deadline)}` : '',
          ]),
          body: item.description || '',
          tags: [item.secure_data_room ? 'Secure data room' : ''],
          icon: 'projects',
          series: '4',
          onClick: () => go(`/workspace/research/projects/${item.id}`),
        }))));
      }
      layout.append(research.box);
    }

    wrap.append(layout);
  } catch (error) {
    const wrap = doc(host, 'Progress');
    const box = C.card({ title: 'Progress could not be loaded', span: 12, tone: 'warning' });
    box.body.append(C.note(error?.message || 'The platform did not return a usable response.'));
    wrap.append(C.bento([box.box]));
  }
}) {
  loading(host);
  try {
    const data = await P.memberDashboard();
    const wrap = doc(
      host,
      'Progress',
      'Your public learning paths, LMS courses and research participation in one account view.',
    );

    const layout = C.bento();

    const tiles = [
      C.statTile({
        value: data.topic_progress?.total || 0,
        label: 'Topics tracked',
        icon: 'target',
        note: data.topic_progress?.completed ? `${data.topic_progress.completed} completed` : 'Public topics',
      }),
      C.statTile({
        value: data.topic_progress?.completed || 0,
        label: 'Topics completed',
        icon: 'activity',
        note: 'Finished topics',
      }),
      C.statTile({
        value: data.public_paths?.in_progress || 0,
        label: 'Public paths',
        icon: 'planning',
        note: 'In progress',
      }),
    ];

    if (data.learning?.access) {
      tiles.push(
        C.statTile({
          value: data.learning?.active || 0,
          label: 'Courses active',
          icon: 'content',
          note: 'LMS',
          onClick: () => go('/workspace/learning/my'),
        }),
        C.statTile({
          value: data.learning?.completed || 0,
          label: 'Courses completed',
          icon: 'notes',
          note: 'LMS',
          onClick: () => go('/workspace/learning/certificates'),
        }),
      );
    }

    if (data.research?.access) {
      tiles.push(C.statTile({
        value: data.research?.projects || 0,
        label: 'Research projects',
        icon: 'projects',
        note: 'Owned or joined',
        onClick: () => go('/workspace/research'),
      }));
    }

    const tileSpan = tiles.length >= 6 ? '2' : tiles.length === 4 ? '3' : '4';
    tiles.forEach((tile, index) => {
      tile.dataset.span = tileSpan;
      tile.dataset.series = String((index % 5) + 1);
    });
    layout.append(...tiles);

    const topics = dashboardCard(
      'Topic progress',
      'Only published Topic activities count: video, discussion, vote and simulation.',
      6,
    );
    const topicItems = data.topic_progress?.items || [];
    if (!topicItems.length) {
      topics.body.append(emptyLine('No topic progress yet. Open a Topic and interact with its published components.'));
    } else {
      const rows = [];
      for (const item of topicItems) {
        const completed = Object.entries(item.applicable || {})
          .filter(([, enabled]) => enabled)
          .map(([key]) => {
            const labels = { video: 'Video', comment: 'Discussion', vote: 'Vote', simulation: 'Simulation' };
            return `${item.done?.[key] ? '✓' : '○'} ${labels[key] || key}`;
          });
        rows.push(detailItem({
          title: item.title,
          meta: `${item.done_count} of ${item.total} activities`,
          tags: [...completed, item.completed ? 'Completed' : 'In progress'],
          percent: item.progress_percent,
          icon: 'target',
          series: '1',
          onClick: () => { if (item.url) location.href = item.url; },
        }));
      }
      topics.body.append(C.list(rows));
    }
    layout.append(topics.box);

    const publicPaths = dashboardCard(
      'Public learning paths',
      'Progress from the public Gravitas+ site follows the same account here.',
      6,
    );
    const paths = data.public_paths?.items || [];
    if (!paths.length) {
      publicPaths.body.append(emptyLine('No public path progress yet. Complete a public learning step to start tracking.'));
    } else {
      publicPaths.body.append(C.list(paths.map((item) => detailItem({
        title: item.title,
        meta: `${item.done_count} of ${item.total} steps`,
        tags: [item.completed ? 'Completed' : 'In progress'],
        percent: item.progress_percent,
        icon: 'planning',
        series: '2',
        onClick: () => { if (item.url) location.href = item.url; },
      }))));
    }
    layout.append(publicPaths.box);

    if (data.learning?.access) {
      const learning = dashboardCard('LMS learning', 'Course progress and certificates.', 6);
      const enrollments = data.learning?.enrollments || [];
      if (!enrollments.length) {
        learning.body.append(emptyLine('No course progress yet. Enroll in a course to start tracking it.'));
      } else {
        learning.body.append(C.list(enrollments.map((item) => detailItem({
          title: item.course_title,
          meta: P.meta([P.label(item.status), item.completed_at ? `Completed ${P.formatDate(item.completed_at)}` : '']),
          tags: [item.certificate?.valid ? 'Certificate' : ''],
          percent: item.progress_percent,
          icon: 'content',
          series: '3',
          onClick: () => go(`/workspace/learning/courses/${item.course_id}`),
        }))));
      }
      layout.append(learning.box);
    }

    if (data.research?.access) {
      const research = dashboardCard('Research participation', 'Project-level access stays authoritative.', 6);
      const projects = data.research?.recent || [];
      if (!projects.length) {
        research.body.append(emptyLine('No research projects yet. Projects you join will appear here.'));
      } else {
        research.body.append(C.list(projects.map((item) => detailItem({
          title: item.title,
          meta: P.meta([
            P.label(item.role),
            P.label(item.status),
            item.deadline ? `Due ${P.formatDate(item.deadline)}` : '',
          ]),
          body: item.description || '',
          tags: [item.secure_data_room ? 'Secure data room' : ''],
          icon: 'projects',
          series: '4',
          onClick: () => go(`/workspace/research/projects/${item.id}`),
        }))));
      }
      layout.append(research.box);
    }

    wrap.append(layout);
  } catch (error) {
    const wrap = doc(host, 'Progress');
    const box = C.card({ title: 'Progress could not be loaded', span: 12, tone: 'warning' });
    box.body.append(C.note(error?.message || 'The platform did not return a usable response.'));
    wrap.append(C.bento([box.box]));
  }
}
