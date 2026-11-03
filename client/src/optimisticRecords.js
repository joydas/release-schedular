export function upsertOptimisticRecord(records, record, idField) {
  const index = records.findIndex((item) => item[idField] === record[idField]);
  if (index === -1) return [...records, record];

  return records.map((item, itemIndex) => (itemIndex === index ? { ...item, ...record } : item));
}

export function replaceRecordFromServer(records, record, idField) {
  if (!record || record[idField] === undefined || record[idField] === null) return records;
  const index = records.findIndex((item) => item[idField] === record[idField]);
  if (index === -1) return [...records, record];

  return records.map((item, itemIndex) => (itemIndex === index ? record : item));
}

export async function runOptimisticMutation({
  applyOptimistic,
  sendMutation,
  reconcile,
  rollback,
}) {
  applyOptimistic();
  try {
    const response = await sendMutation();
    reconcile(response);
    return response;
  } catch (error) {
    rollback();
    throw error;
  }
}
