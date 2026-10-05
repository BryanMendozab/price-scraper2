# Agente inteligente de scraping y monitoreo de precios

Miniproyecto escolar: un sistema que visita fuentes públicas de precios, **detecta
variaciones**, clasifica la importancia de cada cambio y **entrega un reporte** a
Slack, Microsoft Teams o la consola.

No usa datos inventados. Todo lo que se ve en pantalla proviene de una consulta real
a una web pública, salvo el inyector de prueba, que está etiquetado como tal.

---

## 1. Qué hace

1. **Recolecta** — cuatro fuentes distintas (dos APIs JSON, un HTML real y una fuente
   de cotización en vivo) se consultan en paralelo cada N segundos.
2. **Compara** — cada corrida se guarda como un *snapshot* y se contrasta con el
   anterior para detectar precio, stock y productos nuevos o eliminados.
3. **Clasifica** — un motor de reglas asigna severidad según el porcentaje de
   variación y el tipo de cambio.
4. **Resume** — genera un informe con KPIs, eventos destacados e insights escritos en
   español, con formato de moneda y fecha español.
5. **Notifica** — el informe se envía a un webhook de Slack o Teams, o se imprime en la
   consola del servidor.

La detección es **determinista y explicable**: si una alerta salta, se puede leer la
regla exacta que la produjo. No hay caja negra.

---

## 2. Puesta en marcha

Requisitos: **Node.js 20 o superior**.

```bash
npm install
copy .env.example .env     # en PowerShell: Copy-Item .env.example .env
npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:8787>

`npm run dev` levanta ambos procesos a la vez (frontend y backend). El primer
scraping ocurre al arrancar el servidor, así que la pantalla tarda unos segundos en
tener datos.

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Frontend + backend con recarga automática |
| `npm run build` | Verifica tipos y compila el frontend a `dist/` |
| `npm run typecheck` | Solo la verificación de tipos |
| `npm start` | Solo el backend (para probar la API sin la UI) |
| `npm run preview` | Sirve la versión ya compilada |

---

## 3. Fuentes de datos

| Tienda | Origen | Técnica | Qué aporta |
| --- | --- | --- | --- |
| Librería Anglo | `books.toscrape.com` | **Scraping de HTML con Cheerio** | Precio en GBP y stock real (catálogo estable) |
| Mercado cripto | CoinGecko | API JSON | Cotización BTC/ETH en ARS (movimiento real en cada corrida) |
| Mercado eléctrico (OMIE) | ESIOS (Red Eléctrica) | API JSON | Precio PVPC horario en EUR/MWh (movimiento real por franja horaria) |

El scraping se hace con educación: un `User-Agent` que se identifica, un timeout de
15 s por petición y una pausa de 350 ms entre páginas del mismo sitio.

### Agregar una fuente nueva

1. Crear `server/sources/miTienda.ts` que exporte una función `async` que devuelva
   `NormalizedProduct[]` (`id`, `title`, `category`, `price`, `currency`,
   `availability`, `stock`, `url`).
2. Registrarla en `server/sources/index.ts` dentro del array `SOURCES`.

No hay que tocar nada más: el agente, los KPIs, el reporte y la UI la toman sola.

---

## 4. Motor de reglas

Los umbrales son configurables desde la pestaña **Configuración**.

| Tipo de evento | Severidad |
| --- | --- |
| Caída de precio | `info` → `warning` (≥5 %) → `critical` (≥15 %) |
| Suba de precio | `info` → `warning` (≥10 %) → `critical` (≥25 %) |
| Producto sin stock | `warning` |
| Producto agotado por completo | `critical` |
| Producto nuevo / eliminado | `warning` |

La caída de precio pesa menos que la subida: para un comprador, un precio que sube es
una alerta; que baje es una oportunidad.

Además, dos decisiones de diseño que conviene conocer:

- **Las métricas solo comparan monedas iguales.** El precio promedio del mercado se
  calcula únicamente sobre el catálogo de libros en GBP (moneda de referencia). Cripto
  (ARS) y electricidad (EUR/MWh) no se promedian para mantener métricas coherentes.
- **Las fuentes en otras monedas se siguen monitoreando.** Su evolución aparece en la
  tendencia y tablas; los eventos de alerta se generan igual cuando superan el umbral.

### Sobre la detección de cambios

El agente compara cada corrida contra la anterior y solo genera una alerta si la
variación supera el umbral configurado (0,015 % por defecto). Con estas tres fuentes:

- **Librería Anglo** es un catálogo estable: sus precios rara vez cambian.
- **Mercado cripto** y **Mercado eléctrico (OMIE)** son fuentes reales con movimiento
  frecuente. Ajustando el umbral se consiguen alertas reales y visibles, sin datos
  falsos.

El sistema está pensado para alertar únicamente cuando hay cambios **relevantes**, de
forma concreta y sin sobrecarga de información. No se usan datos simulados.

---

## 5. API

Todas las rutas cuelgan de `/api`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Estado, fuentes y cantidad de productos |
| `GET` | `/dashboard` | KPIs, tendencia, tiendas, eventos y ajustes |
| `GET` | `/products` | Listado con filtros `store`, `q` y orden `sort`/`dir` |
| `GET` | `/events` | Alertas con filtros `severity`, `store`, `kind`, `limit` |
| `GET` | `/stores` | Resumen por tienda |
| `POST` | `/stores/:id/test` | Prueba una fuente aislada y devuelve una muestra |
| `POST` | `/scrape/run` | Fuerza una corrida ahora |
| `GET` | `/trend` | Puntos de la serie de precios |
| `GET` | `/reports` | Historial de informes |
| `GET` | `/reports/preview` | Informe en memoria y payload del webhook |
| `POST` | `/reports/generate` | Genera y guarda un informe |
| `POST` | `/reports/send` | Envía el informe a Slack, Teams o consola |
| `GET` | `/export.csv` | Exporta los precios a CSV |
| `GET`/`PUT` | `/settings` | Lee y actualiza la configuración |
| `POST` | `/data/clear` | Borra el historial y reinicia el crawler |

Ejemplo:

```bash
curl http://localhost:8787/api/health
curl "http://localhost:8787/api/products?sort=deltaPct&dir=asc"
curl -X POST http://localhost:8787/api/reports/send \
  -H "Content-Type: application/json" -d "{\"provider\":\"console\"}"
```

---

## 6. Configuración

Las variables de entorno controlan el arranque (`.env.example` documenta todas);
el resto se cambia desde la UI y se guarda en `data/db.json`.

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `8787` | Puerto del servidor |
| `CRAWL_INTERVAL_SECONDS` | `30` | Segundos entre corridas automáticas |
| `CRAWL_USER_AGENT` | identificación del proyecto | User-Agent enviado a los sitios |
| `NOTIFY_PROVIDER` | `console` | `none`, `console`, `slack` o `teams` |
| `SLACK_WEBHOOK_URL` | vacío | Webhook entrante de Slack |
| `TEAMS_WEBHOOK_URL` | vacío | Webhook entrante de Teams |

Los webhooks también se pueden cargar desde **Configuración**; se guardan en el
archivo de datos local, así que **no subas ese archivo a un repositorio**. Está en
`.gitignore`.

### Conectar Slack o Teams

1. Crear una app en el destino y generar un **Incoming Webhook**.
2. Pegar la URL en la pestaña Configuración.
3. Ir a **Reporte** y usar *Enviar ahora*.

Los payloads se arman en `server/report/build.ts`: el de Slack usa bloques `mrkdwn`
y el de Teams usa `Adaptive Cards`, con el mismo contenido.

---

## 7. Estructura

```
├── server/                Backend (Node + Express + TypeScript)
│   ├── index.ts           Arranque y scraping inicial
│   ├── config.ts          Variables de entorno y valores por defecto
│   ├── routes.ts          API REST
│   ├── store.ts           Persistencia JSON con escritura atómica
│   ├── scheduler.ts       Corridas automáticas
│   ├── format.ts          Formato de moneda, fecha y porcentaje
│   ├── sources/           Un módulo por fuente
│   ├── agent/             Comparación de snapshots, KPIs, insights, inyector
│   └── report/            Construcción y envío del informe
├── shared/types.ts        Contrato de tipos compartido por servidor y cliente
├── src/                   Frontend (React + Tailwind)
│   ├── App.tsx            Shell y navegación
│   ├── components/        Vistas y componentes de UI
│   ├── hooks/             Carga de datos y navegación
│   └── lib/               Cliente HTTP y formateo
└── data/db.json           Historial generado (ignorado por git)
```

El scraping vive **solo en el servidor**: el navegador nunca pide datos a las fuentes
externas. Eso evita el problema de CORS y mantiene las claves y la lógica de negocio
fuera del cliente.

---

## 8. Uso responsable

Este proyecto está pensado para prácticas, y conviene decirlo explícitamente:

- Solo consulta **fuentes públicas**, sin login ni contenido de pago.
- Se identifica con un `User-Agent` honesto y respeta un delay entre peticiones.
- No guarda ni pide datos personales de ningún tipo.
- Antes de aplicar esto a un sitio real hay que revisar sus términos de uso, mejorar
  el rate limit y considerar una API oficial. **Un buscador no es un permiso.**

---

## 9. Problemas frecuentes

**El panel aparece vacío.** El primer scraping tarda unos segundos. Revisá
<http://localhost:8787/api/health>: si `runs` es 0, el backend no arrancó.

**Una fuente figura con error.** Es normal si no hay salida de red hacia ese host.
La vista Fuentes muestra el mensaje exacto y el botón de reintento. El resto de las
fuentes sigue funcionando: una caída no frena el sistema.

**El puerto 8787 está ocupado.** `set PORT=9000` antes de `npm run dev` y cambiá
también el proxy en `vite.config.ts`.

**`npm run dev` dice que el puerto 5173 está en uso.** Algo anterior quedó levantado.
Con PowerShell: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 5173).OwningProcess`.

**Los acentos se ven raros en la consola de Windows.** Es la codificación de la
terminal, no los datos: la API devuelve UTF-8 y la interfaz los muestra bien.
