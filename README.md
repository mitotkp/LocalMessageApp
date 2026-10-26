# LocalMessageApp

Chat privado **1 a 1** entre dos equipos de la **misma red local**, sin servidor central ni internet. Las salas se descubren solas por mDNS/Bonjour y todos los mensajes viajan **cifrados de extremo a extremo** (NaCl `box`: Curve25519 + XSalsa20-Poly1305).

Se puede usar de dos formas:

- **Interfaz web** (`npm run web`): una página en el navegador del propio equipo.
- **Terminal** (`npm start`): el mismo flujo en modo consola.

## Requisitos

- Node.js **20.6 o superior** (se usa `--env-file-if-exists`; probado con Node 24).
- Los dos equipos en la misma red/subred, con multicast (mDNS, UDP 5353) permitido.
- El puerto TCP de la sala (**8089**) abierto en el firewall del equipo que crea la sala.

## Instalación

```bash
npm install
cp .env.example .env   # opcional, solo para cambiar el puerto de la interfaz web
```

## Uso

### Interfaz web

```bash
npm run web
```

Abrir `http://localhost:3050` (o el puerto definido en `WEB_PORT`; si no hay `.env`, usa el 3000).

1. Escribir un apodo.
2. **Crear sala** (queda anunciada en la red esperando a alguien) o **Buscar salas** y unirse a una.
3. Chatear. **Salir** cierra la conexión y deja de anunciar la sala.

### Terminal

```bash
npm start
```

Pide apodo, luego `1) Crear sala` o `2) Unirse a una sala`. Dentro del chat, `/exit` sale.

## Variables de entorno

| Variable   | Uso                                         | Por defecto |
|------------|---------------------------------------------|-------------|
| `WEB_PORT` | Puerto de la interfaz web (`npm run web`)   | `3000`      |

El puerto TCP de las salas (8089) y el host de escucha se configuran en `src/config/index.js`.

## Cómo funciona

1. **Descubrimiento** (`src/service/discovery.js`): quien crea la sala la publica por Bonjour con el tipo `encrypt-chat`; quien busca escucha 3 segundos y lista las salas cuya marca `app` coincide.
2. **Conexión** (`src/receiver.js`, `src/transmittor.js`): el anfitrión abre un servidor TCP; el invitado prueba las IPv4 anunciadas (primero las de su misma subred) con 2 s de timeout cada una.
3. **Canal seguro** (`src/events/tcpEvents.js`, `src/service/encryption.js`): al conectar, cada lado genera un par de claves efímero y envía su clave pública; con ellas se deriva un secreto compartido. Cada mensaje lleva un nonce aleatorio. El protocolo es JSON delimitado por saltos de línea (máx. 64 KB por trama).
4. **Mensajes** (`src/models/messageModel.js`): apodo (máx. 32) y texto (máx. 2000), limpiando caracteres de control para que el otro lado no pueda inyectar secuencias ANSI en la terminal.

Es un chat privado: si ya hay alguien conectado a la sala, los siguientes intentos se rechazan. El historial vive solo en memoria (máx. 200 entradas en la web) y se pierde al salir.

### Seguridad de la interfaz web

- El servidor web escucha solo en `127.0.0.1`: nadie más en la red puede controlar tu chat.
- Se validan las cabeceras `Host` y `Origin` (contra DNS rebinding y peticiones desde otros sitios).
- Las peticiones `POST` exigen `Content-Type: application/json`, lo que fuerza un preflight CORS que nunca se concede.
- Los archivos estáticos no pueden salir de `public/` (protección contra `../`).
- Las actualizaciones llegan al navegador por Server-Sent Events (`/api/events`).

> **Limitación**: el intercambio de claves no está autenticado (no hay verificación de huellas), así que protege contra quien solo escucha la red, pero no contra un atacante activo en medio (MITM) dentro de la misma LAN.

## Estructura

```
public/                 Interfaz web (HTML, CSS, JS sin frameworks)
src/
  index.js              Entrada modo terminal
  web.js                Entrada modo web
  webServer.js          Servidor HTTP + API + SSE
  receiver.js           Servidor TCP de la sala (anfitrión)
  transmittor.js        Conexión a una sala (invitado)
  config/index.js       Puerto, host y datos de descubrimiento
  controllers/          Flujo de chat para terminal y para web
  events/tcpEvents.js   Canal cifrado sobre el socket TCP
  models/               Formato y validación de mensajes
  service/              Descubrimiento Bonjour y cifrado NaCl
```

## API local (modo web)

| Método | Ruta            | Cuerpo                    |
|--------|-----------------|---------------------------|
| GET    | `/api/rooms`    | —                         |
| POST   | `/api/rooms`    | `{ nick, roomName }`      |
| POST   | `/api/join`     | `{ nick, roomId }`        |
| POST   | `/api/messages` | `{ text }`                |
| POST   | `/api/leave`    | —                         |
| GET    | `/api/events`   | Stream SSE de estado/mensajes |
