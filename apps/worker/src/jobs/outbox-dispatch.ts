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
      // Counted only when a row actually changed: a claim whose row disappeared
      // before publish was not dispatched, and saying it was would overstate what
      // this cycle achieved.
      const changed = await markOutboxPublished(ev.id);
      if (changed > 0) n += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Belt and braces on top of markOutboxFailed being a no-op for missing
      // rows: whatever goes wrong recording a failure, it must not take the rest
      // of the batch with it. runOnce isolates per-job errors for the same
      // reason; this loop only looked like it did.
      await markOutboxFailed(ev.id, msg).catch((inner) => {
        console.warn(`[outbox] could not record failure for ${ev.id}: ${inner?.message ?? inner}`);
      });
    }
  }
  return n;
}
