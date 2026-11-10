# Sistema de Votaciones · Elección de Profesores

Aplicación para una elección institucional pequeña. El alumno consulta sus datos por DNI, elige uno de cuatro profesores y confirma. El panel en `/admin` muestra los resultados y los registros de participación con búsqueda, filtros y paginación.

## Inicio local

Usa Node.js 24 y pnpm 11. Ejecuta estos comandos desde la carpeta del proyecto.

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm run dev
```

Abre [la votación](http://127.0.0.1:5173/) o [el panel administrativo](http://127.0.0.1:5173/admin). Express escucha en `127.0.0.1:3000` y Vite redirige las solicitudes `/api` al backend.

- Para probar la interfaz con datos ficticios, cambia a `DNI_PROVIDER=mock` y reinicia el backend. El modo de prueba acepta `00000001`, `00000002`, `00000003` y `00000004`. Las identidades son ficticias.
- Copia el valor de `ADMIN_PASSWORD` del archivo local `.env` al formulario de administración. El script genera tanto esa contraseña como la clave HMAC y conserva el archivo si ya existe.
- Cambia los nombres en `backend/config/profesores.json` y reinicia el servidor. Conserva los identificadores si existen votos asociados.
- En el panel, pulsa una tarjeta de resultados para ver los alumnos que votaron por ese profesor. La tabla también permite combinar el filtro con una búsqueda por nombre o apellido.

## Padrón escolar

El modo activo es `DNI_PROVIDER=padron`. El servidor carga `backend/data/padron.json` al arrancar y usa ese archivo como base local. El padrón incluye los 1.301 registros de los 36 listados de 2026 y los campos de cada estudiante. Los números de documento están cifrados. El servidor consulta un HMAC para encontrar un DNI y devuelve únicamente los nombres y apellidos al formulario. Conserva `.env` y el padrón juntos al mover el sistema a otra PC, ya que la clave debe coincidir.

Las matrículas definitivas con DNI se identifican automáticamente. Una matrícula definitiva sin documento registrado puede completar nombres y apellidos con el formato de su matrícula y asociar el DNI al confirmar el voto. El servidor comprueba el DNI y la matrícula para bloquear duplicados. Los trasladados y los registros con carné de extranjería se conservan en el padrón. Este formulario admite solo DNI peruano y matrícula definitiva. La coincidencia de datos no autentica a la persona que usa el formulario.

Los DNI ingresados en este modo quedan cifrados en `backend/data/votos.json` al confirmar. Un identificador HMAC de la matrícula enlaza el voto con el padrón y permite mantener en el mismo archivo la asociación del DNI ingresado y el voto, en una escritura atómica. Guarda respaldos privados de ambos JSON y de `.env`. Los JSON de datos se excluyen de Git y el servidor solo publica los recursos de la interfaz.

Para reemplazar el padrón con listados actualizados, instala Python con `openpyxl`, mantén los cinco directorios de grados bajo una carpeta común y ejecuta lo siguiente desde el proyecto. Reinicia el backend después de la importación.

```powershell
python -m pip install openpyxl
pnpm run importar:padron 'C:/Users/M y H/Desktop'
```

## Scrall RENIEC Básico (opcional)

Para activar este proveedor, selecciona `DNI_PROVIDER=scrall`. Coloca la clave privada de Scrall en `SCRALL_API_KEY` dentro de `.env`, con o sin el prefijo `Basic `. Reinicia el servidor. El backend consulta el [endpoint documentado por Scrall](https://www.scrall.net/apis/reniec_basico) y comprueba que el DNI devuelto coincide. Solo utiliza los nombres y apellidos. Si la búsqueda falla, se puede reintentar y el sistema bloquea el voto hasta obtener una respuesta válida.

La cola de la instancia separa los inicios de consulta por al menos 5,1 segundos para respetar el máximo de dos cada diez segundos. Usa una sola instancia y evita compartir la clave con otros procesos que consuman simultáneamente esa cuota. Se admiten cinco consultas activas o en cola, con espera máxima de treinta segundos y timeout de red de cinco segundos. Para verificar la integración real, usa en la interfaz un DNI propio o autorizado.

## Modo opcional de votación en la PC designada

La configuración incluye `DNI_PROVIDER=dni-local`. Este modo acepta cualquier secuencia de ocho dígitos que aún no haya votado y permite elegir un profesor. No consulta proveedores ni recoge nombres. Los votos se guardan en `backend/data/votos.json` y el panel los muestra como «Sin nombre registrado». La comprobación del HMAC impide repetir el mismo número, pero una persona que escriba distintos números puede registrar votos distintos.

El backend requiere `HOST=127.0.0.1` y `TRUST_PROXY_HOPS=0` para este modo. Con el proyecto compilado, ejecuta `pnpm start` y abre `http://127.0.0.1:3000/` en la PC designada. Ejecuta una sola instancia y conserva `DNI_HMAC_KEY` durante la elección.

## Peru Consult API

Para activar este proveedor opcional necesitas un token local y una fuente autorizada verificada.

El [proyecto de GitHub](https://github.com/giansalex/peru-consult-api) recibe un token local y delega la consulta a la dependencia archivada [giansalex/peru-consult](https://github.com/giansalex/peru-consult), fijada en v4.5.3. Su código hace un POST a un formulario de SUNAT. La prueba desde este entorno, sin enviar un DNI personal, obtuvo HTTP 200 sin el campo que la biblioteca requiere para obtener nombres. El repositorio tiene un [reporte de interrupción cerrado sin un arreglo planificado](https://github.com/giansalex/peru-consult/issues/72). No había un motor Docker disponible y no se comprobó una respuesta con datos reales ni se acreditó autorización de la fuente para este uso. RENIEC documenta su [servicio de verificación para instituciones](https://www.gob.pe/13549-solicitar-acceso-al-servicio-de-verificacion-de-identidad-de-personas-en-reniec-utilizar-web-service-de-datos).

Para evaluar el servicio con autorización y un DNI de prueba aprobado, instala Docker en un equipo de pruebas. Usa un secreto aleatorio para `API_TOKEN` en el entorno de la terminal y pon el mismo valor en `PERU_CONSULT_TOKEN` dentro de `.env`. Publica el puerto solo en la interfaz local y evita registrar la URL de la petición, que contiene el token y el DNI.

```sh
docker run -d -p 127.0.0.1:8080:8080 --name peru-consult --log-driver none -e API_TOKEN giansalex/peru-consult-api
```

En `.env`, selecciona `DNI_PROVIDER=peru-consult`, fija `PERU_CONSULT_ORIGIN=http://127.0.0.1:8080` y reinicia el backend. Express llama a `GET /api/v1/dni/{dni}?token=...`, valida que el DNI de la respuesta coincida y extrae los nombres y apellidos. Usa `DNI_API_TIMEOUT_MS` para controlar el tiempo de espera. El adaptador acepta HTTP solo en loopback y exige HTTPS para orígenes remotos. Peru Consult devuelve HTTP 400 cuando no obtiene una persona, incluso si la fuente devolvió un formato inesperado. El sistema lo trata como verificación fallida y permite reintentar.

Comprueba el resultado en el formulario con el DNI de prueba autorizado. Los nombres y apellidos deben aparecer en campos de solo lectura. Si la consulta falla, puedes cambiar de proveedor mediante el adaptador siguiente.

## Configurar un proveedor autorizado de DNI

Establece `DNI_PROVIDER=api` en `.env`. El adaptador integrado espera una petición **GET por HTTPS** y un objeto JSON con nombres y apellidos. Configura los siguientes valores según el contrato de tu proveedor.

| Variable | Uso |
| --- | --- |
| `DNI_API_URL` | URL HTTPS que contiene el marcador literal `{dni}` en la ruta o en un parámetro de consulta. |
| `DNI_API_AUTH_HEADER` | Nombre de la cabecera para la credencial, por defecto `Authorization`. |
| `DNI_API_AUTH_VALUE` | Valor completo de la cabecera. Incluye el prefijo de autenticación si el proveedor lo requiere. |
| `DNI_API_NAMES_PATH`, `DNI_API_PATERNAL_PATH`, `DNI_API_MATERNAL_PATH` | Rutas a los campos de texto del JSON. Se admite notación con puntos, por ejemplo `datos.nombres`. El apellido materno admite una cadena vacía. |
| `DNI_API_TIMEOUT_MS` | Tiempo de espera entre 100 y 15000 ms, por defecto 5000. |

Un HTTP 404 indica que el documento no se encontró. Si la configuración está incompleta, vence el tiempo de espera, falla la conexión o la respuesta es inválida, el backend impide continuar y el alumno puede reintentar. Si tu proveedor usa otro método, un esquema de autenticación distinto o un formato diferente, adapta `backend/src/services/dni.ts` a su documentación. Las credenciales se usan en el servidor.

La consulta comprueba los duplicados y entrega un comprobante temporal de diez minutos ligado a los datos que obtuvo el servidor. Para incorporar un código individual, conecta un `VoterVerifier` a `createApp` y añade un campo para enviar `codigo` en la solicitud de consulta. El verificador se ejecuta antes de llamar a la fuente de DNI y debe rechazar códigos ausentes o incorrectos. El código no se guarda con el voto. El DNI por sí solo no autentica a la persona ni comprueba que esté matriculada.

## Servidor Node.js

```sh
pnpm run build
pnpm start
```

Con la configuración de desarrollo, esto sirve el frontend compilado y el backend desde `http://127.0.0.1:3000`. Para publicar con un proveedor externo, usa `NODE_ENV=production`, `DNI_PROVIDER=api`, una contraseña administrativa robusta, una clave HMAC de 32 bytes en hexadecimal y `PUBLIC_ORIGIN` con el origen HTTPS exacto, sin barra final. Ejecuta una sola instancia de Node.js detrás de un proxy HTTPS y restringe el acceso directo al puerto del backend. Configura `TRUST_PROXY_HOPS` únicamente si controlas la cadena completa de proxies y el proxy de entrada sanea las cabeceras reenviadas. El modo ficticio se bloquea en producción.

Los votos reales se guardan en `backend/data/votos.json` y los de prueba en `backend/data/votos.mock.json`. Puedes apuntar `VOTES_FILE` a una ruta fuera del frontend en un volumen persistente. El archivo se crea al iniciar el servidor. La escritura usa un archivo temporal en el mismo directorio, sincroniza su contenido y lo reemplaza mediante un renombrado atómico. Una cola dentro del proceso serializa la lectura, la comprobación del duplicado y la escritura. El JSON se valida al iniciar y antes de registrar votos.

JSON es apropiado para una elección pequeña en una sola instancia. Para varios procesos, varios servidores o alta concurrencia se necesita una base de datos transaccional con una restricción única sobre el HMAC. Respalda el archivo de votos y conserva la misma clave HMAC durante toda la elección. Cambiar esa clave invalida la detección de duplicados respecto a los votos anteriores. Restringe los permisos del directorio, de los respaldos y de `.env` a la cuenta de servicio.

**Privacidad.** El sistema registra votos identificables y no constituye una votación secreta. La API pública de identificación devuelve los nombres asociados al DNI ingresado, conforme al flujo solicitado. Los nombres ligados a la selección se consultan mediante la sesión administrativa, que vence a las cuatro horas o al reiniciar el proceso. El archivo de votos contiene un HMAC-SHA256 del DNI y los datos de participación. En el modo padrón también contiene el número ingresado cifrado. Define con la institución quién tendrá acceso y cuánto tiempo se conservarán los registros.

## Estructura

- `frontend/src/components` contiene las pantallas y componentes React.
- `backend/src/routes` contiene las rutas de votación y administración.
- `backend/src/services` contiene la consulta de DNI, los comprobantes temporales y la persistencia.
- `backend/config` contiene la lista editable de profesores.
