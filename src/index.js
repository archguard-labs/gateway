export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Only POST allowed" }), { 
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      const { diff } = await request.json();
      
      if (!diff) {
        return new Response(JSON.stringify({ error: "Missing diff parameter" }), { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const systemPrompt = "You are an elite Senior Software Architect. Your mission is to audit Pull Requests strictly based on clean architecture, decoupling, and security standards.\n\n" +
                           "CRITICAL CHECKLIST:\n" +
                           "1. ARCHITECTURAL DECOUPLING: Ensure core domain logic is decoupled from infrastructure. Catch any leaks where business domains import platform-specific tools.\n" +
                           "2. STATELESS SECURITY: Audit authentication flows (JWT, OAuth2). Flag any hardcoded secrets, weak token generation, or insecure credential management.\n" +
                           "3. CODE QUALITY (SMELLS): Detect overly complex functions, deep nesting, missing error handling (silent failures).\n\n" +
                           "REQUIRED OUTPUT FORMAT:\n" +
                           "If you find any issue, you MUST provide the response strictly using GitHub's suggestion block format so the developer can apply it with 1-click.\n" +
                           "Format your response exactly like this:\n" +
                           "- **Issue**: [Briefly explain what is wrong]\n" +
                           "- **Architectural Impact**: [Why it hurts the system scale/security]\n" +
                           "- **Suggested Fix**:\n" +
                           "```suggestion\n" +
                           "[Provide the exact, clean, ready-to-run replacement code here]\n" +
                           "```\n\n" +
                           "If the code looks completely solid, simply reply with exactly: 'LGTM 👍'";

      // Gọi model AI Cloudflare
      const aiResponse = await env.AI.run('const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here is the Git Diff to review:\n\n${diff}` }
        ]
      });

      let reviewResult = "";
      if (aiResponse && typeof aiResponse === 'object') {
        reviewResult = aiResponse.response || aiResponse.answer || JSON.stringify(aiResponse);
      } else {
        reviewResult = aiResponse || "AI did not return any readable response.";
      }

      return new Response(JSON.stringify({ review: reviewResult }), {
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({ 
        error: "Gateway Internal Error", 
        details: error.message 
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
