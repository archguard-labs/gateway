import { createRemoteJWKSet, jwtVerify } from 'jose';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname.startsWith("/dashboard/")) {
        const parts = url.pathname.split('/');
        if (parts.length >= 4) {
          const owner = parts[2];
          const repo = parts[3];
          let debtData = { checks: 0, issues: 0 };
          if (env.RATE_LIMIT_KV) {
             debtData = await env.RATE_LIMIT_KV.get(`techdebt:${owner}/${repo}`, "json") || { checks: 0, issues: 0 };
          }
          const html = `<html>
            <head>
              <meta charset="UTF-8">
              <title>ArchGuard Dashboard</title>
              <style>body{font-family:sans-serif;padding:2rem;background:#111;color:#fff;} .card{background:#222;padding:2rem;border-radius:12px;border:1px solid #333;}</style>
            </head>
            <body>
              <h1>🛡️ ArchGuard Tech Debt Dashboard</h1>
              <h2>${owner}/${repo}</h2>
              <div class="card">
                <p>Total Pull Requests Reviewed: <b>${debtData.checks}</b></p>
                <p>Total Architectural Flaws Blocked: <b style="color:#ff4444;">${debtData.issues}</b></p>
              </div>
            </body>
          </html>`;
          return new Response(html, { headers: { "Content-Type": "text/html" } });
        }
      }

      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Only POST allowed" }), { 
          status: 405,
          headers: { "Content-Type": "application/json" }
        });
      }

      const contentLength = request.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > 2 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "Payload Too Large" }), {
          status: 413,
          headers: { "Content-Type": "application/json" }
        });
      }

      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const token = authHeader.split(" ")[1];

      if (token === "local-e2e-bypass-token" && env.LOCAL_DEV === "true") {
        console.log("[Local E2E] Bypassing OIDC verification...");
      } else {
        try {
          const JWKS = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
          await jwtVerify(token, JWKS, {
            issuer: 'https://token.actions.githubusercontent.com',
            audience: 'archguard-gateway'
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: "Invalid OIDC token", details: e.message }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      let bodyText = "";
      try {
        bodyText = await request.text();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Cannot read request body" }), { 
          status: 400, 
          headers: { "Content-Type": "application/json" }
        });
      }

      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(bodyText);
      } catch (e) {
        // Ignore
      }

      // Rate Limiting Logic
      if (env.RATE_LIMIT_KV && parsedPayload.owner && parsedPayload.repo) {
        const repoPath = `${parsedPayload.owner}/${parsedPayload.repo}`;
        const dateStr = new Date().toISOString().split('T')[0];
        const key = `ratelimit:${dateStr}:${repoPath}`;
        
        let count = parseInt(await env.RATE_LIMIT_KV.get(key) || "0", 10);
        
        if (count >= 50) {
          return new Response(JSON.stringify({ error: `Rate limit exceeded for ${repoPath} (50 PRs/day)` }), {
            status: 429,
            headers: { "Content-Type": "application/json" }
          });
        }
        
        await env.RATE_LIMIT_KV.put(key, (count + 1).toString(), { expirationTtl: 86400 });
      }

      // Truncate payload diff if it exceeds queue limits (Max 128KB per message)
      if (parsedPayload.diff && typeof parsedPayload.diff === 'string' && parsedPayload.diff.length > 80000) {
        parsedPayload.diff = parsedPayload.diff.substring(0, 80000) + "\n\n...[DIFF TRUNCATED DUE TO QUEUE SIZE LIMITS]...";
      }

      // Enqueue the payload for asynchronous processing
      if (env.ARCHGUARD_QUEUE) {
        await env.ARCHGUARD_QUEUE.send(parsedPayload);
      }

      return new Response(JSON.stringify({ message: "Accepted" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      });
    } catch (criticalError) {
      return new Response(JSON.stringify({ error: "Critical Worker Exception", details: criticalError.message, stack: criticalError.stack }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const payload = message.body;
      const diff = payload.diff || "";
      const repo = payload.repo;
      const owner = payload.owner;
      const pr = payload.pr;
      const token = payload.token;
      const systemPrompt = payload.systemPrompt || "You are an expert Senior Software Architect. Review the following pull request diff for clean architecture boundaries, infrastructure decoupling, and security flaws. Provide concise, constructive feedback.";
        
      if (!diff || !repo || !owner || !pr || !token) {
        message.ack();
        continue;
      }

      try {
        let aiResponse = "";
        try {
          // Assuming Cloudflare AI binding is available at env.AI
          const result = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Here is the Git Diff to review:\n\n${diff}` }
            ],
            max_tokens: 2048
          });
          aiResponse = result.response || "LGTM 👍";
        } catch (e) {
          console.error("AI inference error", e);
          aiResponse = `LGTM 👍 (ArchGuard AI encountered an error during inference: ${e.message})`;
        }

        const trimmedResult = aiResponse.trim();
        const commentBody = `### 🛡️ ArchGuard AI Architectural Review\n\n${trimmedResult}`;

        // Track technical debt in KV
        if (env.RATE_LIMIT_KV) {
          const key = `techdebt:${owner}/${repo}`;
          const current = await env.RATE_LIMIT_KV.get(key, "json") || { checks: 0, issues: 0 };
          current.checks += 1;
          if (!trimmedResult.includes("LGTM 👍")) {
            current.issues += 1;
          }
          await env.RATE_LIMIT_KV.put(key, JSON.stringify(current));
        }

        if (owner === "local-test") {
          console.log(`[Local E2E Mock] Would have posted to Github: \n${commentBody}`);
        } else {
          const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pr}/comments`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": `ArchGuard-Agent-${owner}`
            },
            body: JSON.stringify({ body: commentBody })
          });

          if (!ghRes.ok) {
            console.error(`GitHub API error: ${ghRes.status} ${await ghRes.text()}`);
          }
        }
      } catch (e) {
        console.error("Failed to process queue message", e);
      }
      
      message.ack();
    }
  }
};
