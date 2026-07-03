export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Only POST allowed" }), { status: 405 });
    }

    try {
      const { diff } = await request.json();
      
      const systemPrompt = `You are an elite Senior Software Architect. Your mission is to audit Pull Requests strictly based on clean architecture, decoupling, and security standards.
      
CRITICAL CHECKLIST:
1. ARCHITECTURAL DECOUPLING: Ensure core domain logic is decoupled from infrastructure. Catch any leaks where business domains import platform-specific tools.
2. STATELESS SECURITY: Audit authentication flows (JWT, OAuth2). Flag any hardcoded secrets, weak token generation, or insecure credential management.
3. CODE QUALITY (SMELLS): Detect overly complex functions, deep nesting, missing error handling (silent failures).

REQUIRED OUTPUT FORMAT:
If you find any issue, you MUST provide the response strictly using GitHub's suggestion block format so the developer can apply it with 1-click. 
Format your response exactly like this:
- **Issue**: [Briefly explain what is wrong]
- **Architectural Impact**: [Why it hurts the system scale/security]
- **Suggested Fix**: 
\`\`\`suggestion
[Provide the exact, clean, ready-to-run replacement code here]
\`\`\`

If the code looks completely solid, simply reply with exactly: 'LGTM 👍'`;

      const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here is the Git Diff to review:\n\n${diff}` }
        ]
      });

      return new Response(JSON.stringify({ review: aiResponse.response }), {
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }
};