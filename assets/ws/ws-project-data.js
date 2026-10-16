/* Navigation uses committed project snapshots; opening an item still reads
 * its native version. Bound concurrency so a portfolio cannot occupy every
 * backend worker. The project names become usable before statistics finish. */
export async function loadProjectData(api, onList = () => {}) {
  const list = await api.projects();
  const records = (list.projects || []).map((project) => ({ project, cockpit: null }));
  onList(records);
  let cursor = 0;
  async function worker() {
    while (cursor < records.length) {
      const row = records[cursor++];
      try {
        row.cockpit = await api.projectCockpit(row.project.id, { snapshot: true });
      } catch {
        row.unavailable = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, records.length) }, worker));
  return records;
}
