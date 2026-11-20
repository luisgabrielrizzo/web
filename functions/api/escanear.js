function parsearNumero(valor) {
    if (!valor) return 0;
    let limpio = String(valor).replace(/[^0-9.,-]/g, "").trim();
    if (!limpio) return 0;

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
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}

function armarAsiento(datos) {
    const asiento = [];
    const esFacturaA = /factura\s*a/i.test(datos.tipoComprobante);

    if (esFacturaA && datos.iva > 0) {
        if (datos.netoGravado > 0) {
            asiento.push({ cuenta: "Compras / Gastos", debe: datos.netoGravado, haber: 0 });
        }
        asiento.push({ cuenta: "IVA Crédito Fiscal", debe: datos.iva, haber: 0 });
        if (datos.otrosTributos > 0) {
            asiento.push({ cuenta: "Percepciones / Otros Tributos", debe: datos.otrosTributos, haber: 0 });
        }
    } else if (datos.total > 0) {
        asiento.push({ cuenta: "Gastos Generales / Compras", debe: datos.total, haber: 0 });
    }

    if (datos.total > 0) {
        asiento.push({ cuenta: "Proveedores / Caja", debe: 0, haber: datos.total });
    }

    return asiento;
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

        const prompt = `Extraé únicamente los datos de esta factura o ticket argentino. Completá estas 9 líneas exactas sin agregar explicaciones:

RAZON_SOCIAL: [Nombre de la empresa emisora]
CUIT: [XX-XXXXXXXX-X]
TIPO: [Factura A / Factura B / Factura C / Ticket]
NUMERO: [Punto de venta y número]
FECHA: [DD/MM/AAAA]
NETO: [Importe Subtotal o Neto Gravado, solo número]
IVA: [Importe de IVA, solo número, 0 si no discrimina]
OTROS: [Importe de Percepciones u Otros Tributos, solo número, 0 si no hay]
TOTAL: [Importe Total final, solo número]`;

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
            max_tokens: 512
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

        for (const linea of rawText.split("\n")) {
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
        }

        // Validación matemática: si faltó el Neto pero tenemos Total, lo calculamos por diferencia
        if (resultado.netoGravado === 0 && resultado.total > 0) {
            const calculado = resultado.total - resultado.iva - resultado.otrosTributos;
            resultado.netoGravado = calculado > 0 ? Math.round(calculado * 100) / 100 : resultado.total;
        }

        // Armamos el asiento contable de forma determinística (siempre balanceado)
        resultado.asientoSugerido = armarAsiento(resultado);

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