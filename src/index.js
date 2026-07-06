import { createRemoteJWKSet, jwtVerify } from 'jose';

export default {
  async fetch(request, env) {
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

    // Enqueue the payload for asynchronous processing
    if (env.ARCHGUARD_QUEUE) {
      await env.ARCHGUARD_QUEUE.send(parsedPayload);
    }

    return new Response(JSON.stringify({ message: "Accepted" }), {
      status: 202,
      headers: { "Content-Type": "application/json" }
    });
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
          const result = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Here is the Git Diff to review:\n\n${diff}` }
            ]
          });
          aiResponse = result.response || "LGTM 👍";
        } catch (e) {
          console.error("AI inference error", e);
          aiResponse = "LGTM 👍 (ArchGuard AI encountered an error during inference)";
        }

        const trimmedResult = aiResponse.trim();
        const commentBody = `### 🛡️ ArchGuard AI Architectural Review\n\n${trimmedResult}`;

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
