const MAX_PDF_BASE64_CHARS = 9_500_000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function POST(request) {
  if (!process.env.OPENAI_API_KEY) {
    return json(500, { error: "OPENAI_API_KEY is not configured on the server." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON request body." });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const pdfB64 = typeof body.pdfB64 === "string" ? body.pdfB64 : null;
  const pdfName = typeof body.pdfName === "string" && body.pdfName.trim()
    ? body.pdfName.trim()
    : "assignment-brief.pdf";

  if (!prompt) return json(400, { error: "Prompt is required." });
  if (pdfB64 && pdfB64.length > MAX_PDF_BASE64_CHARS) {
    return json(413, { error: "PDF is too large. Use a PDF smaller than about 7 MB." });
  }

  const content = [];
  if (pdfB64) {
    content.push({
      type: "input_file",
      filename: pdfName,
      file_data: `data:application/pdf;base64,${pdfB64}`,
    });
  }
  content.push({ type: "input_text", text: prompt });

  let openAIResponse;
  try {
    openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content }],
        max_output_tokens: 5000,
      }),
    });
  } catch (error) {
    return json(502, { error: `Could not reach OpenAI: ${error.message}` });
  }

  const data = await openAIResponse.json().catch(() => null);
  if (!openAIResponse.ok) {
    return json(openAIResponse.status, {
      error: data?.error?.message || "OpenAI request failed.",
    });
  }

  const text = data?.output_text || (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item?.text || "")
    .join("");

  if (!text) return json(502, { error: "OpenAI returned no text." });
  return json(200, { text });
}

export function GET() {
  return json(200, { ok: true, service: "AssignmentAI generation API" });
}
