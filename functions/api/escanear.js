function parsearNumero(valor) {
    if (!valor) return 0;
    let limpio = String(valor).replace(/[^0-9.,-]/g, "").trim();
    if (!limpio) return 0;

    // Si tiene punto y coma (ej: 12.500,50 o 12,500.50), detecta cuál es el decimal
    if (limpio.includes(",") && limpio.includes(".")) {
        if (limpio.lastIndexOf(",") > limpio.lastIndexOf(".")) {
            limpio = limpio.replace(/\./g, "").replace(",", ".");
        } else {
            limpio = limpio.replace(/,/g, "");
        }
    } else if (limpio.includes(",")) {
        limpio = limpio.replace(",", ".");
    }
    const num = parseFloat(limpio);
    return isNaN(num) ? 0 : num;
}

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

        const prompt = `Sos un Contador Público argentino. Analizá esta factura o ticket y respondé ÚNICAMENTE completando estas líneas exactas (sin JSON, sin markdown, sin explicaciones):

RAZON_SOCIAL: [Nombre del emisor]
CUIT: [XX-XXXXXXXX-X]
TIPO: [Factura A / B / C / Ticket]
NUMERO: [0001-00001234]
FECHA: [DD/MM/AAAA]
NETO: [solo número]
IVA: [solo número]
OTROS: [solo número]
TOTAL: [solo número]
ASIENTO: [Nombre de cuenta] | [importe Debe] | [importe Haber]
ASIENTO: [Nombre de cuenta] | [importe Debe] | [importe Haber]
ASIENTO: [Nombre de cuenta] | [importe Debe] | [importe Haber]`;

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
            temperature: 0.1,
            max_tokens: 1024
        });

        const rawText = String(aiResponse?.response || aiResponse?.choices?.[0]?.message?.content || "");

        const resultado = {
            razonSocial: "No detectado",
            cuit: "No detectado",
            tipoComprobante: "Comprobante",
            numeroComprobante: "",
            fecha: "-",
            netoGravado: 0,
            iva: 0,
            otrosTributos: 0,
            total: 0,
            asientoSugerido: []
        };

        const lineas = rawText.split("\n");
        for (const linea of lineas) {
            const limpia = linea.replace(/\*\*/g, "").trim();
            if (!limpia.includes(":")) continue;

            const idx = limpia.indexOf(":");
            const clave = limpia.slice(0, idx).trim().toUpperCase();
            const valor = limpia.slice(idx + 1).trim();

            if (clave.includes("RAZON")) resultado.razonSocial = valor;
            else if (clave === "CUIT") resultado.cuit = valor;
            else if (clave === "TIPO") resultado.tipoComprobante = valor;
            else if (clave.includes("NUMERO") || clave.includes("NÚMERO")) resultado.numeroComprobante = valor;
            else if (clave === "FECHA") resultado.fecha = valor;
            else if (clave === "NETO") resultado.netoGravado = parsearNumero(valor);
            else if (clave === "IVA") resultado.iva = parsearNumero(valor);
            else if (clave === "OTROS") resultado.otrosTributos = parsearNumero(valor);
            else if (clave === "TOTAL") resultado.total = parsearNumero(valor);
            else if (clave === "ASIENTO") {
                const partes = valor.split("|").map(p => p.trim());
                if (partes.length >= 3) {
                    resultado.asientoSugerido.push({
                        cuenta: partes[0],
                        debe: parsearNumero(partes[1]),
                        haber: parsearNumero(partes[2])
                    });
                }
            }
        }

        return new Response(JSON.stringify(resultado), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(
            JSON.stringify({ error: "Error en Workers AI: " + error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}