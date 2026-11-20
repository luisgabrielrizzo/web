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

        const prompt = `Sos un Contador Público y Auditor argentino. Analizá esta imagen de un comprobante, factura o ticket de Argentina y extraé los datos fiscales con precisión.
Devolvé ÚNICAMENTE un objeto JSON válido, sin texto adicional ni explicaciones, con esta estructura exacta (si un dato no se ve, poné null o 0 según corresponda):
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
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: dataUri } }
                    ]
                }
            ],
            max_tokens: 1024
        });

        // Extraemos el texto según el formato que devuelva Workers AI
        let rawText = aiResponse?.response || aiResponse?.choices?.[0]?.message?.content || "";
        if (typeof rawText !== "string") {
            rawText = JSON.stringify(rawText);
        }

        // Extraemos únicamente el bloque JSON por si el modelo agrega texto antes o después
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("La IA no devolvió un formato JSON válido.");
        }

        return new Response(jsonMatch[0], {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(
            JSON.stringify({ error: "Error en Workers AI: " + error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}