# Guion de demostración

Duración objetivo: **3 a 5 minutos**. Todo lo que se muestra sale de la app corriendo
en vivo.

---

## Antes de empezar

```bash
npm run dev
```

Dejar el navegador en <http://localhost:5173> y, si se quiere, una pestaña con
<http://localhost:8787/api/health>.

---

## 1. El problema (30 s)

> "Una tienda quiere saber cuándo cambian los precios de su competencia. Hacerlo a mano,
> todos los días, es lento. Este agente consulta solo, compara y avisa."

Aclarar de entrada:

> "Trabaja con tres fuentes públicas reales: una librería que se scrapea del HTML, la
> cotización de Bitcoin y Ethereum, y el precio PVPC horario de la Red Eléctrica.
> No hay datos inventados."

---

## 2. Panorama general — pestaña **Resumen** (60 s)

- **Los KPI**: tiendas monitoreadas, productos rastreados, precio promedio (en la
  moneda del catálogo, GBP) y alertas de las últimas 24 h.
- **La gráfica de tendencia**: el precio promedio a lo largo de las corridas.
- **La tabla por tienda** y **mayores subidas/bajadas**.

Frase para destacar:

> "Los precios que se ven —40 libros, 2 cotizaciones cripto y 1 precio horario de
> electricidad— salieron de consultar tres sitios reales hace unos segundos. El
> navegador solo los pinta; el trabajo lo hace el servidor."

---

## 3. El scraping de verdad (45 s)

Abrir **Fuentes**.

> "Librería Anglo no tiene API: el agente descarga la página y extrae precio y stock del
> HTML con Cheerio. Mercado cripto y Mercado eléctrico consultan APIs públicas (CoinGecko
> y ESIOS/Red Eléctrica)."

Señalar que cada fuente se prueba por separado con **Probar conexión** y que, si una
falla, las demás siguen funcionando.

---

## 4. La variación en vivo (45 s)

Volver a **Resumen** y ejecutar una corrida con **Ejecutar ahora**, o esperar los 30 s
del ciclo automático. Mostrar que los valores de Bitcoin y Ethereum cambian.

> "Los libros casi no cambian de precio, mientras que la cripto y el precio horario de la
> electricidad sí se mueven de forma real. Así combinamos scraping HTML y APIs ligeras,
> mostrando que el agente detecta cambios con datos reales."

---

## 5. Por qué casi no hay alertas (30 s)

Abrir **Alertas**. Probablemente esté vacía. No hay que esconderlo:

> "El agente solo alerta si la variación supera el 0,015 %. Las cripto y la electricidad
> suelen moverse lo suficiente para generar alertas reales con este umbral, mientras que
> el catálogo de libros permanece estable. Las alertas muestran qué cambió, con qué
> porcentaje y cuándo, sin información extra."

---

## 6. El reporte — pestaña **Reporte** (45 s)

- Mostrar la **previsualización** con KPIs e insights en español.
- Cambiar entre **Slack** y **Teams**: el mismo informe en cada formato.
- **Enviar ahora** con proveedor *consola* y mostrar la confirmación.

> "El agente no solo mira: entrega el resultado por donde trabaja el equipo."

---

## 7. Cierre (30 s)

1. **Es real**: dos fuentes públicas consultadas de verdad, una de ellas raspando HTML.
2. **Es explicable**: cada decisión pasa por reglas visibles, sin caja negra.
3. **Es responsable**: fuentes públicas, `User-Agent` honesto y pausas entre peticiones.

---

## Preguntas previsibles

**¿Los datos son reales?** Sí: los libros salen de `books.toscrape.com`, la cotización
de CoinGecko y el PVPC horario de ESIOS/Red Eléctrica, consultados en vivo.

**¿Qué pasa si un sitio se cae?** El sistema lo registra con su error y sigue con el
resto. La pestaña Fuentes muestra el estado y permite reintentar.

**¿Se puede agregar otra tienda?** Sí: un módulo que devuelva el formato común y una
entrada en `SOURCES`. El resto del sistema la toma sin cambios.

**¿Por qué no usa IA?** Porque el problema es determinista y conviene poder explicar
cada alerta. Reglas = predecible, barato y sin sorpresas.

**¿Por qué no hay alertas?** Porque ninguna variación superó el umbral. Es el
comportamiento correcto: alertar de más también sería un fallo.
