export default {
  async fetch(request, env) {
    // 1. Chỉ chấp nhận phương thức POST
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Only POST allowed" }), { 
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    let diff = "";

    // 2. Bộ lọc dữ liệu thông minh (Chống crash tuyệt đối khi parse JSON)
    try {
      // Thử đọc theo kiểu JSON chuẩn trước
      const bodyText = await request.text();
      try {
        const parsed = JSON.parse(bodyText);
        diff = parsed.diff || bodyText;
      } catch (e) {
        // Nếu không phải JSON chuẩn (dính lỗi parse), coi nguyên cái body đó là chuỗi diff luôn!
        diff = bodyText;
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: "Cannot read request body", details: err.message }), { 
        status: 400, 
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. Tiến hành gọi AI xử lý khi đã có chuỗi diff sạch
    try {
      const systemPrompt = "You are an elite Senior Software Architect. Your mission is to audit Pull Requests strictly based on clean architecture, decoupling, and security standards.\n\n" +
                           "CRITICAL CHECKLIST:\n" +
                           "1. ARCHITECTURAL DECOUPLING: Ensure core domain logic is decoupled from infrastructure.\n" +
                           "2. STATELESS SECURITY: Audit authentication flows, flag hardcoded secrets.\n" +
                           "3. CODE QUALITY: Detect missing error handling.\n\n" +
                           "REQUIRED OUTPUT FORMAT:\n" +
                           "Format your response exactly like this:\n" +
                           "- **Issue**: [What is wrong]\n" +
                           "- **Architectural Impact**: [Why it hurts system]\n" +
                           "- **Suggested Fix**:\n" +
                           "```suggestion\n" +
                           "[Provide clean replacement code]\n" +
                           "```\n\n" +
                           "If the code looks solid, reply with: 'LGTM 👍'";

      // Gọi model Llama 3.1 ổn định nhất hiện tại
      const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here is the Git Diff to review:\n\n${diff}` }
        ]
      });

      // Bóc tách kết quả an toàn
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
        error: "AI Generation Error", 
        details: error.message 
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
