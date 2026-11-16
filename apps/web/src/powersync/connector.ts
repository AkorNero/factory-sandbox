import type { AbstractPowerSyncDatabase, CrudEntry, PowerSyncBackendConnector } from '@powersync/web';

const DEVICE_KEY = 'dayplanner.deviceId';

/** The device identity: created on first visit, kept on the device. No login. */
export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked: a fresh identity per page load still works
  }
}

export class Connector implements PowerSyncBackendConnector {
  /**
   * PowerSync rejects tokens that live longer than 24 h, so the "long-lived" part is the device id.
   * Every call trades it for a fresh short-lived JWT; the SDK calls this again before expiry.
   */
  async fetchCredentials() {
    const res = await fetch('/api/device-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: getOrCreateDeviceId() }),
    });
    if (!res.ok) throw new Error(`device-token ${res.status}`); // offline is normal: the SDK retries later
    const { token } = (await res.json()) as { token: string };
    return { endpoint: `${location.origin}/powersync`, token };
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const batch = await database.getCrudBatch(100);
    if (!batch) return;
    const ops = batch.crud.map((op: CrudEntry) => ({
      op: op.op, // 'PUT' | 'PATCH' | 'DELETE'
      table: op.table,
      id: op.id,
      data: op.opData ?? null, // PUT: whole row; PATCH: only the changed columns
    }));
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
    });
    if (res.status >= 400 && res.status < 500) {
      // Permanent: this batch can never succeed. Drop it, or the queue is stuck forever.
      console.error('upload rejected', res.status, await res.text());
    } else if (!res.ok) {
      throw new Error(`upload failed ${res.status}`); // transient: the SDK retries and keeps the queue
    }
    await batch.complete();
  }
}
