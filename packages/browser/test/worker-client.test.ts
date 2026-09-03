/**
 * PolyWorker request coalescing.
 *
 * Uses a fake Worker that answers on demand, so the test controls exactly
 * when each build "finishes" and can observe what the worker was asked to do.
 */

import { describe, it, expect } from 'vitest';
import { PolyWorker } from '../src/worker-client.js';
import type { WorkerRequest, WorkerResponse } from '../src/worker-entry.js';

class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  received: WorkerRequest[] = [];
  terminated = false;

  postMessage(req: WorkerRequest): void {
    this.received.push(req);
    // init answers immediately; builds wait for answer().
    if (req.type === 'init') this.answer(req.id, { ok: true });
  }

  answer(id: number, extra: Partial<WorkerResponse>): void {
    const req = this.received.find((r) => r.id === id)!;
    this.onmessage?.({ data: { id, type: req.type, ok: true, ...extra } } as MessageEvent<WorkerResponse>);
  }

  builds(): WorkerRequest[] {
    return this.received.filter((r) => r.type === 'build');
  }

  terminate(): void {
    this.terminated = true;
  }
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

function makeWorker(): { pw: PolyWorker; fake: FakeWorker } {
  const fake = new FakeWorker();
  // The constructor's `instanceof Worker` check needs a Worker global; the
  // fake stands in for it.
  const g = globalThis as unknown as { Worker: unknown };
  const saved = g.Worker;
  g.Worker = FakeWorker;
  try {
    return { pw: new PolyWorker(fake as unknown as Worker), fake };
  } finally {
    g.Worker = saved;
  }
}

describe('PolyWorker.build coalescing', () => {
  it('runs builds one at a time and keeps only the newest waiting request', async () => {
    const { pw, fake } = makeWorker();

    const p1 = pw.build('a');
    await flush();
    expect(fake.builds().map((b) => b.code)).toEqual(['a']);

    // Two more arrive while 'a' is running: only the last survives.
    const p2 = pw.build('b');
    const p2Rejected = expect(p2).rejects.toThrow('Build superseded');
    const p3 = pw.build('c');
    await p2Rejected;
    expect(fake.builds().map((b) => b.code)).toEqual(['a']);

    fake.answer(fake.builds()[0].id, { volume: 1 });
    const r1 = await p1;
    expect(r1.ok).toBe(true);
    await flush();
    // 'c' was posted only after 'a' finished; 'b' never reached the worker.
    expect(fake.builds().map((b) => b.code)).toEqual(['a', 'c']);

    fake.answer(fake.builds()[1].id, { volume: 3 });
    const r3 = await p3;
    expect(r3.volume).toBe(3);
  });

  it('delivers the in-flight result rather than discarding it', async () => {
    const { pw, fake } = makeWorker();
    const p1 = pw.build('a');
    await flush();
    const p2 = pw.build('b');
    fake.answer(fake.builds()[0].id, { volume: 1 });
    expect((await p1).volume).toBe(1);
    await flush();
    fake.answer(fake.builds()[1].id, { volume: 2 });
    expect((await p2).volume).toBe(2);
  });

  it('rejects a waiting build on terminate', async () => {
    const { pw, fake } = makeWorker();
    const p1 = pw.build('a');
    await flush();
    const p2 = pw.build('b');
    pw.terminate();
    expect(fake.terminated).toBe(true);
    await expect(p1).rejects.toThrow('Worker terminated');
    await expect(p2).rejects.toThrow('Worker terminated');
  });
});
