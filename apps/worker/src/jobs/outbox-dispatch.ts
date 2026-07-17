// Marks unpublished outbox events as published after a no-op "dispatch".
// Notification channels are deferred (events.yaml) — publishing means the event
// is durable and available for future consumers without dual-write loss.
import {
  claimUnpublishedOutbox,
  markOutboxPublished,
  markOutboxFailed,
} from '@seip/database';

export async function dispatchOutboxBatch(limit = 50): Promise<number> {
  const batch = await claimUnpublishedOutbox(limit);
  let n = 0;
  for (const ev of batch) {
    try {
      // Future: fan-out to notification service. For now, publish = acknowledge.
      await markOutboxPublished(ev.id);
      n += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markOutboxFailed(ev.id, msg);
    }
  }
  return n;
}
