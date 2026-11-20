export async function onRequestPost(context) {
    try {
        if (!context.env.AI) {
            return new Response(
                JSON.stringify({ error: "Falta vincular Workers AI en Cloudflare (Settings -> Bindings -> Variable name: AI)." }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const { imageBase64, mimeType } = await context.request.json();
        const dataUri = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;

        const systemPrompt = `Sos un extractor automático de datos contables de facturas argentinas.
Respondé ÚNICAMENTE con un objeto JSON válido. No escribas saludos, ni explicaciones, ni markdown.`;

        const userPrompt = `Extraé los datos de este comprobante y devolvé exactamente este JSON (si falta un dato, usá null o 0):
{
    "razonSocial": "Nombre del emisor",
    "cuit": "XX-XXXXXXXX-X",
    "tipoComprobante": "Factura A / B / C / Ticket",
    "numeroComprobante": "0001-00001234",
    "fecha": "DD/MM/AAAA",
    "netoGravado": 0,
    "iva": 0,
    "otrosTributos": 0,
    "total": 0,
    "asientoSugerido": [
        { "cuenta": "Nombre de cuenta contable", "debe": 0, "haber": 0 }
    ]
}`;

        const aiResponse = await context.env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: userPrompt },
                        { type: "image_url", image_url: { url: dataUri } }
                    ]
                }
            ],
            temperature: 0.1,
            max_tokens: 1024
        });

        let rawText = aiResponse?.response || aiResponse?.choices?.[0]?.message?.content || "";
        if (typeof rawText !== "string") {
            rawText = JSON.stringify(rawText);
        }

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("La IA respondió texto en vez de JSON: " + rawText.slice(0, 180));
        }

        // Validamos que el JSON extraído sea parseable antes de enviarlo al navegador
        const parsed = JSON.parse(jsonMatch[0]);

        return new Response(JSON.stringify(parsed), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(
            JSON.stringify({ error: "Error en Workers AI: " + error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}