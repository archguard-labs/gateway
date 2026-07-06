import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

describe('HMAC Verification Worker', () => {
  const MASTER_KEY = 'secret-master-key';
  
  async function generateHMAC(body, repo, timestamp) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(MASTER_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body + repo + timestamp)
    );
    return Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  it('Success Path: should accept perfectly matching HMAC signatures and valid timestamps (HTTP 202)', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ diff: "some diff code", repo: "test-repo" });
    const signature = await generateHMAC(body, "test-repo", timestamp);
    
    const request = new Request('http://localhost/audit', {
      method: 'POST',
      headers: {
        'X-ArchGuard-Signature': signature,
        'X-ArchGuard-Timestamp': timestamp.toString(),
      },
      body
    });

    const mockQueue = { send: async () => {} };
    const response = await worker.fetch(request, { 
      ARCHGUARD_MASTER_KEY: MASTER_KEY,
      ARCHGUARD_QUEUE: mockQueue
    });
    expect(response.status).toBe(202);
  });

  it('Payload Size Limits: should return HTTP 413 if content-length exceeds 2MB', async () => {
    const request = new Request('http://localhost/audit', {
      method: 'POST',
      headers: {
        'Content-Length': (2 * 1024 * 1024 + 1).toString()
      }
    });
    const response = await worker.fetch(request, { ARCHGUARD_MASTER_KEY: MASTER_KEY });
    expect(response.status).toBe(413);
  });

  it('Tampered Payload Path: should return HTTP 401 Unauthorized if body diff is altered', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ diff: "original code", repo: "test-repo" });
    const signature = await generateHMAC(body, "test-repo", timestamp);
    
    const tamperedBody = JSON.stringify({ diff: "altered code", repo: "test-repo" });
    const request = new Request('http://localhost/audit', {
      method: 'POST',
      headers: {
        'X-ArchGuard-Signature': signature,
        'X-ArchGuard-Timestamp': timestamp.toString(),
      },
      body: tamperedBody
    });

    const response = await worker.fetch(request, { ARCHGUARD_MASTER_KEY: MASTER_KEY });
    expect(response.status).toBe(401);
  });

  it('Replay Attack Path: should return HTTP 401 Unauthorized if timestamp drifts > 300s', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const body = JSON.stringify({ diff: "some diff code", repo: "test-repo" });
    const signature = await generateHMAC(body, "test-repo", timestamp);
    
    const request = new Request('http://localhost/audit', {
      method: 'POST',
      headers: {
        'X-ArchGuard-Signature': signature,
        'X-ArchGuard-Timestamp': timestamp.toString(),
      },
      body
    });

    const response = await worker.fetch(request, { ARCHGUARD_MASTER_KEY: MASTER_KEY });
    expect(response.status).toBe(401);
  });
});
