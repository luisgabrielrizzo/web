export async function onRequestPost(context) {
    try {
        const apiKey = context.env.GEMINI_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Cloudflare." }), { status: 500 });
        }

        const { imageBase64, mimeType } = await context.request.json();

        const prompt = `Sos un Contador Público y Auditor argentino. Analizá esta imagen de un comprobante/factura/ticket de Argentina y extraé los datos fiscales con precisión.
        Devolvé ÚNICAMENTE un objeto JSON válido con esta estructura exacta (si un dato no se ve, poné null o 0 según corresponda):
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

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        { inline_data: { mime_type: mimeType, data: imageBase64 } }
                    ]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        const data = await response.json();
        const textoJson = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textoJson) {
            throw new Error("No se pudo interpretar la respuesta de la IA.");
        }

        return new Response(textoJson, {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: "Error procesando la factura: " + error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}