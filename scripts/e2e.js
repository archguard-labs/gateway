const LOCAL_GATEWAY_URL = 'http://127.0.0.1:8787/audit';

async function runE2E() {
  console.log("🚀 [E2E Test] Starting Local End-to-End Test...");

  const diff = `
  + function createAdmin() {
  +   db.query("INSERT INTO users (role) VALUES ('admin')"); // Bad architecture, hardcoded DB
  + }
  `;
  
  const payload = {
    diff: diff,
    repo: "local-e2e-repo",
    owner: "local-test", // Flag for the Gateway to mock the Github API instead of sending real requests
    pr: 1,
    token: "fake-github-token",
    systemPrompt: "You are an elite Senior Software Architect. Review the following pull request diff for clean architecture boundaries, infrastructure decoupling, and security flaws. Provide concise, constructive feedback."
  };

  const rawBody = JSON.stringify(payload);
  try {
    const response = await fetch(LOCAL_GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ArchGuard-Agent-local-test",
        "Authorization": "Bearer local-e2e-bypass-token"
      },
      body: rawBody
    });

    console.log(`📥 [E2E Test] Gateway Response Status: ${response.status}`);
    const text = await response.text();
    console.log(`📥 [E2E Test] Gateway Response Body: ${text}`);

    if (response.status === 202) {
      console.log("✅ [E2E Test] Payload accepted successfully! Now watch your Wrangler Dev terminal to see the Queue Consumer & AI running.");
    } else {
      console.log("❌ [E2E Test] Failed. Gateway rejected the payload.");
    }
  } catch (e) {
    console.log("❌ [E2E Test] Error connecting to local gateway. Did you run 'npx wrangler dev'?");
  }
}

runE2E();
