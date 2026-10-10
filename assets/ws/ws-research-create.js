/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  RESEARCH · CREATING THINGS
   The two ways into new research work: a project, and a task inside one.

   Before this module, three overlays each painted their own creation
   controls onto the Research screens after those screens had drawn:
   ws-research-actions.js put a short "New project" form under the Projects
   head; ws-space-integration.js removed that toolbar and painted a fuller
   one with the Space category; ws-task-deck-fixes.js added "New task" and
   moved it into whichever of the two toolbars it found first. The form a
   researcher saw depended on which observer fired last, and creating a
   project reloaded the whole workspace.

   Now each screen draws its own buttons and calls these two dialogs. The
   project dialog is the full one, because a project's Space category decides
   where its Markdown file and folder are created in Nextcloud and cannot be
   left to a default later. After creating, the reader is taken to the new
   project or its tasks; nothing reloads.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261008-operational2';
import * as K from './ws-admin-kit.js?v=20261011-r1';

const { el } = K;

const PROJECT_TYPES = [['internal', 'Internal research'], ['client', 'Client / revenue'], ['community', 'Community research']];
const VISIBILITY = [['private', 'Private'], ['invite', 'Invite only'], ['community', 'Community'], ['public', 'Public']];
const CONFIDENTIALITY = [['internal', 'Internal'], ['restricted', 'Restricted'], ['public', 'Public']];
const PRIORITY = [['p0', 'P0 · Critical'], ['p1', 'P1 · High'], ['p2', 'P2 · Normal'], ['p3', 'P3 · Low']];
const PROJECT_ERRORS = {
  invalid_space_category: 'That category is no longer available. Pick another.',
  title_required: 'A project needs a title.',
  invalid_visibility: 'Choose a valid visibility.',
};

function flatten(nodes, depth = 0, out = []) {
  for (const node of nodes || []) {
    out.push({ ...node, depth });
    flatten(node.children || [], depth + 1, out);
  }
  return out;
}

// Categories a project can be filed in, indented by depth, with the usual
// Space/Research/Projects preselected.
function fillCategories(select, tree, keep = '') {
  select.replaceChildren();
  const categories = flatten(tree).filter((item) => item.kind === 'category');
  for (const item of categories) {
    select.append(new Option(`${'— '.repeat(Math.max(0, item.depth - 1))}${item.title}`, String(item.id)));
  }
  const preferred = categories.find((item) => item.path === 'Space/Research/Projects') || categories[0];
  select.value = keep || (preferred ? String(preferred.id) : '');
  return categories;
}

function fillParents(select, tree) {
  select.replaceChildren();
  const parents = flatten(tree).filter((item) => ['subspace', 'category'].includes(item.kind));
  for (const item of parents) select.append(new Option(`${'— '.repeat(item.depth)}${item.title}`, String(item.id)));
  const preferred = parents.find((item) => item.path === 'Space/Research') || parents[0];
  if (preferred) select.value = String(preferred.id);
}

export async function openNewProject({ go } = {}) {
  let tree = [];
  let treeError = '';
  try {
    tree = (await P.call('/platform/space/tree/')).tree || [];
  } catch (error) {
    treeError = error?.message === 'cloud_unavailable'
      ? 'Space is unavailable in Nextcloud right now, so a project cannot be filed. Try again shortly.'
      : 'Space categories could not be loaded.';
  }

  K.dialog('New research project', (grid) => {
    const title = K.input('', 'text', 'Project title');
    title.required = true;
    const type = K.select(PROJECT_TYPES, 'internal');
    const visibility = K.select(VISIBILITY, 'private');
    const category = el('select', 'v-input');
    fillCategories(category, tree);
    const question = K.textarea('', 3, 'The question this project answers');
    const description = K.textarea('', 3, 'Scope or context');
    const deadline = K.input('', 'date');
    const confidentiality = K.select(CONFIDENTIALITY, 'internal');
    const client = K.input('', 'text', 'Client name');
    const requester = K.input('', 'text', 'Requester name');
    const requesterEmail = K.input('', 'email', 'requester@example.com');
    const skills = K.input('', 'text', 'Python, statistics, biology');
    const compensation = K.input('', 'text', 'Commercial terms');
    const applications = K.toggle(false, 'Applications open', 'Researchers can apply to join.');
    const secure = K.toggle(false, 'Secure data room', 'No public links, stricter file access.');
    const links = K.toggle(false, 'Allow public links');
    const downloads = K.toggle(true, 'Allow downloads');

    // A missing category can be made without leaving the dialog.
    const newCategory = K.input('', 'text', 'New category name');
    const parent = el('select', 'v-input');
    fillParents(parent, tree);
    const categoryLine = K.status();
    const addCategory = K.button('Create category', async () => {
      const wanted = newCategory.value.trim();
      if (!wanted) { K.setStatus(categoryLine, 'Name the category first.', 'bad'); return; }
      addCategory.disabled = true;
      K.setStatus(categoryLine, 'Creating…');
      try {
        await P.call('/platform/space/tree/', { method: 'POST', body: { title: wanted, kind: 'category', parent_id: parent.value } });
      } catch (error) {
        // WebDAV can fail after the row was saved; the refetch below decides.
        if (error?.message !== 'cloud_unavailable') K.setStatus(categoryLine, String(error?.message || 'Not created').replaceAll('_', ' '), 'bad');
      }
      try {
        tree = (await P.call('/platform/space/tree/')).tree || [];
        const made = fillCategories(category, tree).find((item) => item.title.toLowerCase() === wanted.toLowerCase());
        fillParents(parent, tree);
        if (made) {
          category.value = String(made.id);
          newCategory.value = '';
          K.setStatus(categoryLine, `“${made.title}” is ready.`, 'ok');
        } else {
          K.setStatus(categoryLine, 'The category could not be confirmed. Try again when Nextcloud answers.', 'bad');
        }
      } catch {
        K.setStatus(categoryLine, 'Saved, but the category list could not be refreshed.', 'bad');
      }
      addCategory.disabled = false;
    }, { tiny: true });

    if (treeError) grid.append(K.C.note(treeError));
    grid.append(
      K.fields([
        K.field('Title', title),
        K.field('Project type', type, 'What kind of work this is.'),
        K.field('Visibility', visibility),
        K.field('Space category', category, 'Its Markdown file and folder are created here in Nextcloud.'),
        K.field('Deadline', deadline),
        K.field('Confidentiality', confidentiality),
      ], 2),
      K.field('Research question', question, '', { wide: true }),
      K.field('Description', description, '', { wide: true }),
      K.fields([K.field('Client', client), K.field('Requester', requester), K.field('Requester email', requesterEmail), K.field('Required skills', skills, 'Comma-separated'), K.field('Compensation', compensation)], 2),
      K.switches([applications, secure, links, downloads]),
      K.heading('Need another category?'),
      K.fields([K.field('Name', newCategory), K.field('Inside', parent)], 2),
      K.cardActions([addCategory], categoryLine),
    );
    return { title, type, visibility, category, question, description, deadline, confidentiality, client, requester, requesterEmail, skills, compensation, applications, secure, links, downloads };
  }, {
    submit: 'Create project',
    onSubmit: async (f) => {
      if (!f.title.value.trim()) throw new Error(PROJECT_ERRORS.title_required);
      if (!f.category.value) throw new Error('Choose or create a Space category first.');
      let result;
      try {
        result = await P.call('/platform/projects/', { method: 'POST', body: {
          title: f.title.value.trim(),
          category: f.type.value,
          visibility: f.visibility.value,
          space_category_id: Number(f.category.value),
          research_question: f.question.value.trim(),
          description: f.description.value.trim(),
          client_name: f.client.value.trim(),
          requester_name: f.requester.value.trim(),
          requester_email: f.requesterEmail.value.trim(),
          deadline: f.deadline.value || null,
          confidentiality: f.confidentiality.value,
          compensation_text: f.compensation.value.trim(),
          required_skills: f.skills.value.split(',').map((item) => item.trim()).filter(Boolean),
          application_open: f.applications.input.checked,
          secure_data_room: f.secure.input.checked,
          allow_public_links: f.links.input.checked,
          allow_downloads: f.downloads.input.checked,
        } });
      } catch (error) {
        throw new Error(PROJECT_ERRORS[error?.message] || String(error?.message || 'The project was not created.').replaceAll('_', ' '));
      }
      const id = result?.project?.id;
      if (id && go) go(`/workspace/research/projects/${id}`);
    },
  });
}

export async function openNewTask({ go } = {}) {
  let projects = [];
  try {
    projects = ((await P.call('/platform/projects/')).projects || []).filter((project) => project.permissions?.can_edit);
  } catch {
    projects = [];
  }
  if (!projects.length) {
    K.dialog('New research task', (grid) => {
      grid.append(K.C.note('A task belongs to a project. Create a project first, or ask for edit access to an existing one.'));
    }, go ? { submit: 'Open projects', onSubmit: async () => go('/workspace/research/projects') } : {});
    return;
  }
  K.dialog('New research task', (grid) => {
    const project = K.select(projects.map((item) => [String(item.id), item.title]), String(projects[0].id));
    const title = K.input('', 'text', 'Task title');
    title.required = true;
    const due = K.input('', 'date');
    due.required = true;
    const priority = K.select(PRIORITY, 'p2');
    const done = K.textarea('', 3, 'What must be true for this to be finished?');
    const description = K.textarea('', 3, 'Optional context');
    grid.append(
      K.fields([K.field('Project', project), K.field('Task title', title), K.field('Due date', due), K.field('Priority', priority)], 2),
      K.field('Definition of done', done, '', { wide: true }),
      K.field('Description', description, '', { wide: true }),
    );
    return { project, title, due, priority, done, description };
  }, {
    submit: 'Create task',
    onSubmit: async (f) => {
      const projectId = Number(f.project.value);
      const result = await P.call(`/platform/projects/${projectId}/tasks/`, { method: 'POST', body: {
        title: f.title.value.trim(),
        due_date: f.due.value,
        priority: f.priority.value,
        definition_of_done: f.done.value.trim(),
        description: f.description.value.trim(),
        status: 'active',
      } });
      if (!result?.task?.id) throw new Error('The task was not created.');
      if (go) go(`/workspace/research/projects/${projectId}/tasks`);
    },
  });
}
