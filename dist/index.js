(() => {
  // src/index.js
  var src_default = {
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
      const signature = request.headers.get("X-ArchGuard-Signature");
      const timestamp = request.headers.get("X-ArchGuard-Timestamp");
      if (!signature || !timestamp) {
        return new Response(JSON.stringify({ error: "Missing authentication headers" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      const currentTimestamp = Math.floor(Date.now() / 1e3);
      const incomingTimestamp = parseInt(timestamp, 10);
      if (isNaN(incomingTimestamp) || Math.abs(currentTimestamp - incomingTimestamp) > 300) {
        return new Response(JSON.stringify({ error: "Timestamp drift violation" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
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
      let repoName = "";
      try {
        parsedPayload = JSON.parse(bodyText);
        repoName = parsedPayload.repo || "";
      } catch (e) {
      }
      const encoder = new TextEncoder();
      const signingText = bodyText + repoName + timestamp;
      try {
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(env.ARCHGUARD_MASTER_KEY),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"]
        );
        const signatureBuffer = new Uint8Array(
          signature.match(/[\da-f]{2}/gi)?.map((h) => parseInt(h, 16)) || []
        );
        const isValid = await crypto.subtle.verify(
          "HMAC",
          key,
          signatureBuffer,
          encoder.encode(signingText)
        );
        if (!isValid) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (env.ARCHGUARD_QUEUE) {
          await env.ARCHGUARD_QUEUE.send(parsedPayload);
        }
        return new Response(JSON.stringify({ message: "Accepted" }), {
          status: 202,
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: "Verification failed", details: error.message }), {
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
            const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Here is the Git Diff to review:

${diff}` }
              ]
            });
            aiResponse = result.response || "LGTM \u{1F44D}";
          } catch (e) {
            console.error("AI inference error", e);
            aiResponse = "LGTM \u{1F44D} (ArchGuard AI encountered an error during inference)";
          }
          const trimmedResult = aiResponse.trim();
          const commentBody = `### \u{1F6E1}\uFE0F ArchGuard AI Architectural Review

${trimmedResult}`;
          if (owner === "local-test") {
            console.log(`[Local E2E Mock] Would have posted to Github: 
${commentBody}`);
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
})();
