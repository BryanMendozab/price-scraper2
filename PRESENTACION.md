# Agente de monitoreo de precios cripto — Presentación (10 min)

> Cómo exponer: una diapositiva por momento, frases cortas en pantalla.
> Debajo de cada una hay un bloque **Qué decir** con el guion sugerido.

---

## 1. Portada

**[Nombre del equipo]** — Integrantes: [Nombre 1], [Nombre 2], […]

**Agente inteligente de monitoreo de precios de criptomonedas**

*Hoy les mostramos un sistema que vigila el mercado solo, decide solo y avisa solo.*

**Qué decir:**
> "Somos [equipo]. Nuestro miniproyecto es un agente que monitorea precios de criptomonedas en tiempo real, simula estrategias de inversión y manda alertas al correo. Hoy se los mostramos funcionando en vivo."

---

## 2. Problema y solución

**Problema:** revisar precios a mano, todo el día, es lento y siempre llegas tarde.

**Solución:** un agente que consulta el mercado cada 30 segundos, detecta movimientos y te avisa al correo.

**Qué decir:**
> "El problema es simple: nadie puede vigilar 10 monedas todo el día. Nuestra solución es un agente que lo hace solo, con dinero ficticio para probar estrategias sin arriesgar nada. Al final verán la demo con datos reales, nada inventado."

---

## 3. Demo 1 — Monitoreo en vivo

Mostrar: **Resumen** (gráfica base 100) y **Productos** (tabla con cambio en 10 min).

**Qué decir:**
> "Esto es en vivo: Bitcoin, Ethereum y 8 más, actualizados hace segundos. La gráfica parte de 100 para comparar quién se mueve sin que el precio gigante de Bitcoin aplaste a las demás. La tabla ordena por lo que más se movió en 10 minutos."

---

## 4. Demo 2 — El piloto opera solo

Mostrar: **Piloto** (billeteras) + botón **Operar ahora** + **Historial**.

**Qué decir:**
> "Aquí están 4 traders automáticos —scalper, day trader, swing y holder— cada uno con $10,000 ficticios solo en Bitcoin. Pulso Operar ahora y el sistema decide al momento. Todo queda registrado: qué compró, a qué precio y por qué."

---

## 5. Demo 3 — Alertas y Excel

Mostrar: un correo real recibido + botón **Excel** en Reporte.

**Qué decir:**
> "Cuando algo se mueve más de 0.5% en 10 minutos, llega este correo solo. Y con un clic se descarga el Excel con billeteras, operaciones y alertas. Esto es lo que el cliente se llevaría."

---

## 6. Arquitectura (breve)

* Frontend: React + Vite · Backend: Node + Express · Datos: CoinGecko + JSON local
* El navegador nunca toca CoinGecko: todo pasa por el servidor (evita CORS y cuida las claves).

**Qué decir:**
> "React pinta, Node trabaja: el scraping, las reglas y los correos viven en el servidor. Los datos se guardan en un archivo local, sin base de datos."

---

## 7. Decisiones y retos

* **Reglas en vez de IA:** cada alerta se puede explicar ("vendió porque tocó +2%"). Predecible y barato.
* **Base 100 en la gráfica:** para que Bitcoin no aplaste a las demás.
* **Reto superado:** CoinGecko limita las consultas gratis — lo resolvimos con caché, pausas y reintentos.

**Qué decir:**
> "Decidimos reglas visibles en lugar de caja negra: si algo se vende, sabemos exactamente por qué. Nuestro reto real fue el límite de consultas de CoinGecko, y lo resolvimos cacheando y espaciando peticiones."

---

## 8. Resultados

* 10 monedas monitoreadas cada 30 s, sin caídas.
* Piloto operando solo con bitácora completa y correos reales entregados.
* Backtest: comparamos qué hubiera rendido cada estilo en 30 días.

**Qué decir:**
> "Funciona: monitorea sin parar, el piloto opera y deja rastro, los correos llegan y el Excel sale con un clic. Todo lo que vieron son datos reales de hoy."

---

## 9. Limitaciones honestas

* Dinero ficticio: no opera de verdad en ningún exchange.
* CoinGecko gratis: datos con minutos de retraso y tope de consultas.
* Sin usuarios ni contraseñas (proyecto escolar).

**Qué decir:**
> "Siendo honestos: es dinero de juguete, los datos gratuitos tienen minutos de retraso y no hay cuentas de usuario. Para producción faltaría un exchange real y datos en vivo por segundo."

---

## 10. Cierre

* El agente vigila, decide y avisa solo — demostrado en vivo.
* Siguiente paso: conectar un exchange real y alertas por WhatsApp.

**Qué decir:**
> "En resumen: un agente que vigila 10 criptos, opera solo con 4 estrategias y avisa por correo, todo verificable. Gracias — ¿preguntas?"

---

## Entrega (no exponer, solo checklist)

* Enviar antes de las 2:30 PM del día de la expo a eduardo.castillo02@iest.edu.mx.
* Asunto: nombre del equipo + tema del miniproyecto.
* Incluir: presentación, video de la demo y archivos del proyecto.
