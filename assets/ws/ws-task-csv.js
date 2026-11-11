/* CSV is exported from the already-authorized task-board response.
   This module is intentionally browser-native and dependency-free: exporting
   should not make another API request or require edit permissions. */
const COLUMNS = [
  ['Task ID', task => task.id],
  ['Title', task => task.title],
  ['Status', task => task.status],
  ['Priority', task => task.priority],
  ['Owner', task => task.owner?.name],
  ['Owner Email', task => task.owner?.email],
  ['Project', task => task.project_title],
  ['Objective', task => task.trace?.objective?.title],
  ['Key Result', task => task.trace?.key_result?.title],
  ['Initiative', task => task.initiative_title],
  ['Milestone', task => task.milestone_title],
  ['Work Package', task => task.work_package_title],
  ['Parent Task ID', task => task.parent_id],
  ['Workflow State', task => task.workflow_state],
  ['Due Date', task => task.due_date],
  ['Started At', task => task.started_at],
  ['Completed At', task => task.completed_at],
  ['Created At', task => task.created_at],
  ['Updated At', task => task.updated_at],
  ['Description', task => task.description],
  ['Definition of Done', task => task.definition_of_done],
  ['Blocked Reason', task => task.blocked_reason],
  ['Checklist Completed', task => task.checklist_completed_count],
  ['Checklist Total', task => task.checklist_count],
  ['Comments', task => task.comment_count],
  ['Attachments', task => task.attachment_count],
];

function csvCell(value) {
  const text = String(value ?? '').replace(/\0/g, '');
  // Spreadsheet applications may execute formulas in untrusted task titles,
  // descriptions, or owner names, even when the CSV field is quoted.
  const safe = /^[\x00-\x20]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function tasksToCsv(tasks) {
  const rows = [
    COLUMNS.map(([title]) => title),
    ...tasks.map(task => COLUMNS.map(([, read]) => read(task))),
  ];
  // UTF-8 BOM makes names and non-Latin text readable in Excel.
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadTaskCsv(tasks, today = new Date()) {
  if (!tasks.length) return false;
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  const blob = new Blob([tasksToCsv(tasks)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `graviquest-tasks-${date}.csv`;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoke after the click has had a chance to hand the file to the browser.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}
