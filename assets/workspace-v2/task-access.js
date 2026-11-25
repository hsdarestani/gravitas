export function canReadTask(item, member) {
  return Boolean(item && (item.visibility !== 'private' ||
    Boolean(member && (item.accessOwner === member || item.owners.includes(member) ||
      item.collaboratorIds.includes(member) || item.allowedMembers?.includes(member)))));
}

export function taskAccessFields(visibility, invited, item, member) {
  return visibility === 'private'
    ? {visibility:'private', allowedMembers:[...new Set(invited)], accessOwner:item?.accessOwner || member}
    : {visibility:'workspace', allowedMembers:[], accessOwner:item?.accessOwner || ''};
}

export function canReadEvent(event, member, findTask) {
  return (!event.task || canReadTask(findTask(event.task),member)) &&
    (!event.relatedTasks || event.relatedTasks.every(id=>canReadTask(findTask(id),member)));
}
