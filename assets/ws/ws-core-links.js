/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  CROSS-LAYER LINKS
   Connect one canonical Core task to the Research project, LMS course or
   lesson, public-site content or production item it belongs to.

   A link is a relationship, not a copy: removing it never deletes either
   object. The screen is drawn with ws-admin-kit.js like the rest of
   Platform Admin. It used to be four unlabeled selects in a row above a
   list, which read as a filter rather than a form; it is now a labelled
   form beside the chosen task's links, so what you pick and what it is
   already linked to are on screen together.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261008-operational2';
import * as K from './ws-admin-kit.js?v=20261011-r1';

const { el } = K;

const TARGETS = [
  ['research-project', 'Research project', 'space-research'],
  ['course', 'LMS course', 'course'],
  ['lesson', 'LMS lesson', 'learning'],
  ['public-content', 'Public-site content', 'topic'],
  ['content-work', 'Content pipeline item', 'content'],
];

function taskTitle(task) {
  return `${task.title}${task.owner?.name ? ` · ${task.owner.name}` : ''}`;
}

export async function renderCoreLinks(host) {
  K.loading(host, 'Cross-layer links', { tiles: 0, cards: [6, 6] });
  try {
    const [taskData, researchData, courseData, siteData, workData] = await Promise.all([
      P.operatingTasks(),
      P.adminResearchProjects(),
      P.lmsCourses({ all: true }),
      P.adminSiteContent(),
      P.content(),
    ]);

    const tasks = taskData.tasks || [];
    const sources = {
      'research-project': (researchData.projects || []).map((item) => ({ id: item.id, title: item.title })),
      course: (courseData.courses || []).map((item) => ({ id: item.id, title: item.title })),
      lesson: [],
      'public-content': (siteData.items || []).map((item) => ({ id: item.id, title: item.title })),
      'content-work': (workData.items || []).map((item) => ({ id: item.id, title: item.title })),
    };

    // Course detail carries lessons, so fetch them once and flatten them into
    // the same target picker. A failed single course must not hide the rest.
    const courseDetails = await Promise.allSettled((courseData.courses || []).map((course) => P.lmsCourse(course.id)));
    courseDetails.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const course = result.value.course;
      for (const module of course.modules || []) {
        for (const lesson of module.lessons || []) {
          sources.lesson.push({ id: lesson.id, title: `${course.title} / ${module.title} / ${lesson.title}` });
        }
      }
    });

    const wrap = K.page(host, {
      title: 'Cross-layer links',
      meta: 'Connect one canonical Core task to the Research project, LMS course or lesson, public-site content or production item it belongs to.',
    });

    const editor = K.card({ title: 'Link a task', note: 'A link is a relationship, not a copy. Removing it never deletes either object.', span: 6 });
    const taskSelect = K.select([['', 'Choose Core task'], ...tasks.map((task) => [String(task.id), taskTitle(task)])], '');
    const typeSelect = K.select(TARGETS.map(([value, text]) => [value, text]), 'research-project');
    const targetSelect = K.select([], '');
    const relation = K.input('related', 'text', 'supports / produces / requires');
    const status = K.status();

    const refill = () => {
      const options = sources[typeSelect.value] || [];
      targetSelect.replaceChildren();
      const first = el('option', null, options.length ? 'Choose target' : 'Nothing of this kind yet');
      first.value = '';
      targetSelect.append(first);
      for (const item of options) {
        const option = el('option', null, item.title);
        option.value = String(item.id);
        targetSelect.append(option);
      }
    };
    typeSelect.addEventListener('change', refill);
    refill();

    const save = K.button('Create link', async () => {
      if (!taskSelect.value || !targetSelect.value) {
        K.setStatus(status, 'Choose both a task and a target.', 'bad');
        return;
      }
      save.disabled = true;
      K.setStatus(status, 'Linking…');
      try {
        await P.call(`/operating/tasks/${taskSelect.value}/links/`, {
          method: 'POST',
          body: { target_type: typeSelect.value, target_id: Number(targetSelect.value), relation: relation.value.trim() || 'related' },
        });
        K.setStatus(status, 'Link created.', 'ok');
        await drawLinks();
      } catch (error) {
        K.setStatus(status, error?.message || 'The link could not be created.', 'bad');
      } finally {
        save.disabled = false;
      }
    }, { solid: true });

    editor.body.append(
      K.fields([
        K.field('Core task', taskSelect, tasks.length ? '' : 'No Core tasks exist yet.', { wide: true }),
        K.field('Target kind', typeSelect),
        K.field('Relation', relation, 'A short verb: supports, produces, requires.'),
        K.field('Target', targetSelect, '', { wide: true }),
      ], 2),
      K.cardActions([save], status),
    );

    const existing = K.card({ title: 'Links on this task', note: 'Choose a task to see what it is connected to.', span: 6 });
    const marks = Object.fromEntries(TARGETS.map(([value, , mark]) => [value, mark]));

    const drawLinks = async () => {
      if (!taskSelect.value) {
        existing.body.replaceChildren(K.empty('Choose a task; its cross-layer relationships appear here.'));
        return;
      }
      existing.body.replaceChildren(el('div', 'fl-skeleton adm-skeleton'));
      try {
        const data = await P.call(`/operating/tasks/${taskSelect.value}/links/`);
        const links = data.links || [];
        existing.body.replaceChildren(links.length ? K.list(links.map((link, index) => {
          const remove = K.button('Remove link', async () => {
            remove.disabled = true;
            try {
              await P.call(`/operating/tasks/${taskSelect.value}/links/`, { method: 'DELETE', body: { link_id: link.id } });
              await drawLinks();
            } catch (error) {
              remove.disabled = false;
              K.setStatus(status, error?.message || 'The link could not be removed.', 'bad');
            }
          }, { tiny: true, danger: true });
          return K.row({
            title: link.title,
            meta: P.label(link.target_type),
            lead: K.avatar(link.title, { mark: marks[link.target_type] || 'link', series: (index % 4) + 1 }),
            badges: [K.badge(P.label(link.relation))],
            actions: [remove],
          });
        })) : K.empty('No links yet. Use the form to connect this task to another layer.'));
      } catch (error) {
        existing.body.replaceChildren(K.empty(error?.message || 'Links could not be loaded.'));
      }
    };
    taskSelect.addEventListener('change', drawLinks);

    wrap.append(K.bento([editor.box, existing.box]));
    await drawLinks();
  } catch (error) {
    K.failure(host, 'Cross-layer links', error, () => renderCoreLinks(host));
  }
}
