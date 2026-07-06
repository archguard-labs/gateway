export default {
  async fetch(request: Request, env: any): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Only POST allowed" }), { 
        status: 405,
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

    const currentTimestamp = Math.floor(Date.now() / 1000);
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

    let repoName = "";
    try {
      const parsed = JSON.parse(bodyText);
      repoName = parsed.repo || "";
    } catch (e) {
      // Ignore
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

      // Convert hex signature string to ArrayBuffer
      const signatureBuffer = new Uint8Array(
        signature.match(/[\da-f]{2}/gi)?.map(h => parseInt(h, 16)) || []
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

      return new Response(JSON.stringify({ message: "Accepted" }), {
        status: 202,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error: any) {
      return new Response(JSON.stringify({ error: "Verification failed", details: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
