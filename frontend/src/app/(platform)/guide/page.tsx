import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function GuidePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16">
      <div>
        <h1 className="text-3xl font-bold">Guía completa — AgroESP32</h1>
        <p className="text-muted-foreground mt-2">
          Cómo registrar nodos, flashear firmware y entender cómo fluyen los datos de campo a la plataforma.
        </p>
      </div>

      {/* ── ÍNDICE ── */}
      <Card className="bg-gray-50 border-gray-200">
        <CardContent className="py-4 text-sm space-y-1">
          <p className="font-semibold mb-2">Contenido</p>
          {[
            ['#arquitectura', '1. Arquitectura del sistema'],
            ['#roles', '2. Tipos de dispositivo: emisor y receptor'],
            ['#flujo-web', '3. Flujo no-code (desde la web)'],
            ['#flujo-plat', '4. Flujo manual (PlatformIO)'],
            ['#multiples', '5. Múltiples emisores por receptor'],
            ['#gps', '6. GPS y modo cache RTC'],
            ['#firmware', '7. Subir firmware a la plataforma'],
            ['#migracion', '8. Primer uso: aplicar migraciones'],
            ['#faq', '9. Preguntas frecuentes'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="block text-green-700 hover:underline">
              {label}
            </a>
          ))}
        </CardContent>
      </Card>

      {/* ── 1. ARQUITECTURA ── */}
      <section id="arquitectura" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">1. Arquitectura del sistema</h2>
        <p className="text-sm text-muted-foreground">
          El sistema tiene tres capas: nodos de campo (emisores), gateway local (receptor) y plataforma en la nube.
        </p>
        <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-4 font-mono leading-relaxed overflow-x-auto">{`
  [Emisor A]  ──LoRa──►│                    │
  [Emisor B]  ──LoRa──►│  Receptor           │──WiFi/HTTPS──►  Railway API
  [Emisor C]  ──LoRa──►│  (gateway ESP32)    │                  │
                        └────────────────────┘                  │
                                                                 │
                                                     ┌───────────▼──────────┐
                                                     │   Django + Postgres   │
                                                     │   WebSocket           │
                                                     └───────────┬──────────┘
                                                                 │
                                                     ┌───────────▼──────────┐
                                                     │   Browser (Next.js)  │
                                                     │   Gráficas + alertas │
                                                     └──────────────────────┘
`}</pre>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="border rounded-lg p-3">
            <p className="font-semibold">Emisor</p>
            <p className="text-muted-foreground text-xs mt-1">Lee sensores (SHTC3, DS18B20, GPS, batería), arma un JSON y lo transmite por radio LoRa @ 915 MHz. Luego duerme N minutos.</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="font-semibold">Receptor</p>
            <p className="text-muted-foreground text-xs mt-1">Escucha permanentemente en LoRa. Cuando recibe un paquete válido, lo reenvía a la API por WiFi con autenticación Bearer.</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="font-semibold">Plataforma</p>
            <p className="text-muted-foreground text-xs mt-1">Recibe, guarda y visualiza los datos. Distribuye actualizaciones en tiempo real por WebSocket. Gestiona dispositivos y firmware.</p>
          </div>
        </div>
      </section>

      {/* ── 2. ROLES ── */}
      <section id="roles" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">2. Tipos de dispositivo</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <Card className="border-green-200">
            <CardHeader className="pb-2"><CardTitle className="text-base text-green-700">📡 Emisor (Nodo Sensor)</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>Va en el campo, parcela o invernadero. Corre con batería.</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Tiene su propio <code className="bg-gray-100 px-0.5 rounded">device_id</code> único</li>
                <li>Intervalo de sueño configurable (por defecto 10 min)</li>
                <li>Sensores seleccionables: SHTC3, DS18B20, GPS, batería</li>
                <li>No necesita WiFi — se comunica por LoRa</li>
              </ul>
              <p className="font-medium text-gray-700">Config que recibe:</p>
              <code className="block bg-gray-100 rounded p-2 text-xs">{`{ "device_id": "parcela-01", "sleep_minutes": 10 }`}</code>
            </CardContent>
          </Card>
          <Card className="border-blue-200">
            <CardHeader className="pb-2"><CardTitle className="text-base text-blue-700">🔌 Receptor (Gateway)</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>Va enchufado en el galpón o invernadero. Necesita WiFi.</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Escucha todos los emisores en rango simultáneamente</li>
                <li>Tiene su propio token de autenticación (Bearer)</li>
                <li>Reconecta el WiFi automáticamente si se cae</li>
                <li>Un receptor puede servir a ~30–50 emisores</li>
              </ul>
              <p className="font-medium text-gray-700">Config que recibe:</p>
              <code className="block bg-gray-100 rounded p-2 text-xs">{`{ "wifi_ssid": "Mi_Red", "wifi_pass": "pass", "api_url": "...", "api_token": "..." }`}</code>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── 3. FLUJO NO-CODE ── */}
      <section id="flujo-web" className="space-y-4">
        <h2 className="text-xl font-bold border-b pb-2">3. Flujo no-code (desde la web)</h2>
        <p className="text-sm text-muted-foreground">
          Sin PlatformIO, sin archivos, sin terminal. Solo necesitás Chrome o Edge y el ESP32 conectado por USB.
        </p>
        <div className="space-y-3">
          {[
            {
              step: '1',
              title: 'Registrar el receptor primero',
              desc: 'Ve a Dispositivos → Registrar nuevo nodo → Tipo: Receptor. Completá el nombre, un ID (ej: "gateway-01"), la red WiFi y la contraseña. Guardá.',
              note: 'El receptor debe existir antes de crear emisores para poder asignárselo.',
            },
            {
              step: '2',
              title: 'Flashear el receptor',
              desc: 'En la página del receptor, hacé click en "⚡ Flash firmware". Seleccioná la versión receptor, conectá el ESP32 por USB y presioná "Conectar y flashear".',
              note: 'El sistema flashea el firmware Y envía automáticamente el WiFi + token al ESP32. No hay que editar ningún archivo.',
            },
            {
              step: '3',
              title: 'Registrar cada emisor',
              desc: 'Volvé a Registrar nuevo nodo → Tipo: Emisor. Completá nombre, ID único (ej: "parcela-norte-01"), elegí los sensores instalados, el intervalo de sueño y seleccioná el receptor del dropdown.',
              note: 'Cada emisor necesita un device_id distinto. Si tenés 5 emisores, tenés 5 registros.',
            },
            {
              step: '4',
              title: 'Flashear cada emisor',
              desc: 'En la página de cada emisor, click en "⚡ Flash firmware". El mismo proceso: seleccioná versión emisor, conectá, flasheá.',
              note: 'El device_id y el sleep_minutes se envían automáticamente al chip.',
            },
            {
              step: '5',
              title: 'Listo',
              desc: 'Los emisores despiertan, leen sensores y transmiten por LoRa. El receptor los captura y los envía a la plataforma. Los datos aparecen en el dashboard en tiempo real.',
              note: '',
            },
          ].map(({ step, title, desc, note }) => (
            <div key={step} className="flex gap-4">
              <div className="flex-none w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold">
                {step}
              </div>
              <div className="flex-1 space-y-1">
                <p className="font-semibold text-sm">{title}</p>
                <p className="text-sm text-muted-foreground">{desc}</p>
                {note && (
                  <p className="text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-800">{note}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. FLUJO PLATFORMIO ── */}
      <section id="flujo-plat" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">4. Flujo manual (PlatformIO / VSCode)</h2>
        <p className="text-sm text-muted-foreground">
          Para desarrolladores que quieren compilar con su propio código. Ambos flujos coexisten — el NVS tiene prioridad sobre secrets.h, pero si hay secrets.h y no hay NVS, lo usa.
        </p>
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2"><Badge variant="outline" className="flex-none">1</Badge><span>Registrá el dispositivo en la plataforma (igual que no-code).</span></li>
          <li className="flex gap-2"><Badge variant="outline" className="flex-none">2</Badge><span>En la página del dispositivo, descargá el <code className="bg-gray-100 px-1 rounded">secrets.h</code> con el botón "Descargar secrets.h".</span></li>
          <li className="flex gap-2"><Badge variant="outline" className="flex-none">3</Badge><span>Copiá ese archivo a <code className="bg-gray-100 px-1 rounded">src/emisor/secrets.h</code> o <code className="bg-gray-100 px-1 rounded">src/receptor/secrets.h</code> según corresponda.</span></li>
          <li className="flex gap-2"><Badge variant="outline" className="flex-none">4</Badge><span>En PlatformIO, seleccioná el environment correcto (<code className="bg-gray-100 px-1 rounded">emisor</code> o <code className="bg-gray-100 px-1 rounded">receptor</code>) y hacé Upload.</span></li>
        </ol>
        <div className="bg-gray-900 text-green-400 rounded-lg p-3 font-mono text-xs">
          <div className="text-gray-500"># src/emisor/secrets.h (generado por la plataforma)</div>
          <div>#define DEVICE_ID_SECRET  &quot;parcela-norte-01&quot;</div>
          <div>#define SLEEP_MINUTES     10</div>
          <div className="mt-2 text-gray-500"># src/receptor/secrets.h</div>
          <div>#define WIFI_SSID_SECRET  &quot;Mi_Red&quot;</div>
          <div>#define WIFI_PASS_SECRET  &quot;mi_password&quot;</div>
          <div>#define API_URL_SECRET    &quot;https://...railway.app/api/telemetry/&quot;</div>
          <div>#define API_TOKEN_SECRET  &quot;9388bcf2ab3e...&quot;</div>
        </div>
      </section>

      {/* ── 5. MÚLTIPLES EMISORES ── */}
      <section id="multiples" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">5. Múltiples emisores</h2>
        <p className="text-sm text-muted-foreground">
          Un receptor puede recibir de muchos emisores al mismo tiempo, sin configuración especial.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="border rounded-lg p-3 space-y-1">
            <p className="font-semibold">¿Cómo los distingue el backend?</p>
            <p className="text-xs text-muted-foreground">Cada emisor incluye su <code className="bg-gray-100 px-0.5 rounded">device_id</code> dentro del JSON LoRa. El receptor lo reenvía al backend que lo usa para identificar de qué nodo vienen los datos.</p>
          </div>
          <div className="border rounded-lg p-3 space-y-1">
            <p className="font-semibold">¿Cuántos emisores por receptor?</p>
            <p className="text-xs text-muted-foreground">Con deep sleep de 10 minutos, ~30–50 emisores sin problemas de colisión LoRa. No hay límite de software.</p>
          </div>
          <div className="border rounded-lg p-3 space-y-1">
            <p className="font-semibold">¿Qué pasa si dos transmiten a la vez?</p>
            <p className="text-xs text-muted-foreground">LoRa no tiene CSMA/CA. Los paquetes colisionan y se pierden. Con pocos nodos y deep sleep largo, la probabilidad es muy baja.</p>
          </div>
          <div className="border rounded-lg p-3 space-y-1">
            <p className="font-semibold">¿Y si un emisor está fuera de rango?</p>
            <p className="text-xs text-muted-foreground">Los datos se pierden ese ciclo. El emisor intenta de nuevo en el próximo wakeup. El backend marca el nodo como offline si pasan más de 15 minutos sin datos.</p>
          </div>
        </div>
      </section>

      {/* ── 6. GPS ── */}
      <section id="gps" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">6. GPS y modo cache RTC</h2>
        <p className="text-sm text-muted-foreground">
          El GPS es el sensor más problemático en sistemas de deep sleep porque cada vez que el ESP32 duerme, el módulo GPS pierde su fix.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="border rounded-lg p-3">
            <p className="font-semibold text-xs">Cold start (primer encendido)</p>
            <p className="text-xs text-muted-foreground mt-1">Sin cache previo → espera hasta 60 segundos para obtener fix. Si no lo consigue, envía sin GPS.</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="font-semibold text-xs">Warm start (con cache)</p>
            <p className="text-xs text-muted-foreground mt-1">Tiene última posición en RTC memory → espera 30 segundos. Si no obtiene fix nuevo, envía la última posición conocida.</p>
          </div>
          <div className="border rounded-lg p-3">
            <p className="font-semibold text-xs">Dato en cache</p>
            <p className="text-xs text-muted-foreground mt-1">El payload lleva <code className="bg-gray-100 px-0.5 rounded text-xs">"cached": true</code> en el objeto gps para indicar que es la última posición conocida, no un fix fresco.</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded px-3 py-2">
          La memoria RTC del ESP32 sobrevive el deep sleep pero se borra si se corta la alimentación completamente.
          Para GPS siempre actualizado se recomienda un módulo con batería de respaldo (pin VBAT).
        </p>
      </section>

      {/* ── 7. FIRMWARE ── */}
      <section id="firmware" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">7. Subir firmware a la plataforma</h2>
        <p className="text-sm text-muted-foreground">
          La sección <strong>Firmware</strong> del menú te permite subir los binarios compilados (.bin) que luego se usan para flashear desde la web.
        </p>
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2">
            <Badge variant="outline" className="flex-none">1</Badge>
            <span>En PlatformIO, compilá el proyecto (sin hacer upload): <code className="bg-gray-100 px-1 rounded">pio run -e emisor</code> o desde la UI el botón de Build.</span>
          </li>
          <li className="flex gap-2">
            <Badge variant="outline" className="flex-none">2</Badge>
            <span>El binario queda en <code className="bg-gray-100 px-1 rounded">.pio/build/emisor/firmware.bin</code> (o <code className="bg-gray-100 px-1 rounded">receptor</code>). Importante: este .bin <strong>no debe tener secrets.h bakeado</strong> para funcionar con el flujo web.</span>
          </li>
          <li className="flex gap-2">
            <Badge variant="outline" className="flex-none">3</Badge>
            <span>Ve a la sección <strong>Firmware → Subir nuevo build</strong>, completá la versión (ej: 1.2.0), el tipo (emisor/receptor) y subí el .bin.</span>
          </li>
        </ol>
        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
          <strong>Para el flujo no-code:</strong> el firmware debe compilarse <em>sin</em> <code>secrets.h</code> en el directorio fuente.
          Así el ESP32 entra en modo provisioning y recibe la config por serial.
          Para el flujo PlatformIO: compilá con secrets.h normalmente.
        </div>
      </section>

      {/* ── 8. MIGRACIÓN ── */}
      <section id="migracion" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">8. Primer uso: aplicar migraciones</h2>
        <p className="text-sm text-muted-foreground">
          Antes de usar la plataforma por primera vez (o tras actualizar el código), hay que aplicar las migraciones de base de datos.
        </p>
        <div className="bg-gray-900 text-green-400 rounded-lg p-3 font-mono text-xs space-y-1">
          <div className="text-gray-500"># Desde la carpeta backend/ con el virtualenv activo</div>
          <div>python manage.py migrate</div>
          <div className="mt-2 text-gray-500"># Para borrar todos los dispositivos y empezar desde cero:</div>
          <div>python manage.py shell -c &quot;from apps.devices.models import Device; Device.objects.all().delete()&quot;</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Si ves errores al crear dispositivos o al listar receptores, probablemente falta aplicar la migración 0004 que agrega el campo <code className="bg-gray-100 px-0.5 rounded">assigned_gateway</code>.
        </p>
      </section>

      {/* ── 9. FAQ ── */}
      <section id="faq" className="space-y-3">
        <h2 className="text-xl font-bold border-b pb-2">9. Preguntas frecuentes</h2>
        <div className="space-y-3">
          {[
            {
              q: '¿Por qué dice "No hay receptores registrados aún"?',
              a: 'Porque no hay ningún receptor registrado todavía, O porque falta aplicar python manage.py migrate. Registrá un receptor primero (Tipo: Receptor en el formulario), luego el dropdown aparecerá.',
            },
            {
              q: '¿Puedo asignar un emisor a un receptor después de crearlo?',
              a: 'Sí. El campo es opcional al crear. Para asignarlo después, en la lista de dispositivos o desde el detalle de dispositivo podrás hacer PATCH en el futuro. Por ahora, si lo olvidaste al crear, borralo y volvé a registrarlo.',
            },
            {
              q: '¿El flash web funciona en Safari o Firefox?',
              a: 'No. Web Serial API solo está disponible en Chrome y Edge (navegadores basados en Chromium). Safari y Firefox no lo soportan.',
            },
            {
              q: '¿Cómo pongo el ESP32 en modo flash?',
              a: 'Mantenés presionado el botón BOOT y luego presionás EN (o reset). Soltás BOOT. Esto pone el chip en modo bootloader. esptool-js hace esto automáticamente con DTR/RTS si el adaptador USB-Serie lo soporta.',
            },
            {
              q: '¿Qué pasa si el ESP32 ya tiene config en NVS y lo flasheo de nuevo?',
              a: 'eraseFlash() borra TODO el flash incluyendo la partición NVS. El ESP32 queda sin config y entra en modo provisioning. La plataforma le manda la nueva config automáticamente por serial.',
            },
            {
              q: '¿Puedo tener más de un receptor?',
              a: 'Sí. Cada receptor tiene su propio provisioning_token. Se registran de la misma forma. Los emisores no saben qué receptor los escucha — LoRa es broadcast. El backend registra en source_gateway qué receptor recibió cada dato.',
            },
            {
              q: '¿El dato de GPS siempre es en tiempo real?',
              a: 'No necesariamente. Si el GPS no obtiene fix en el timeout configurado, envía la última posición conocida (cache RTC) con el campo "cached": true. La RTC memory del ESP32 sobrevive el deep sleep pero no un corte total de alimentación.',
            },
            {
              q: '¿Por qué los emisores usan deep sleep y el receptor no?',
              a: 'Los emisores son nodos de batería — necesitan dormir para ahorrar energía. El receptor está enchufado permanentemente y necesita escuchar LoRa todo el tiempo.',
            },
          ].map(({ q, a }) => (
            <div key={q} className="border rounded-lg p-4 space-y-2">
              <p className="font-semibold text-sm">{q}</p>
              <p className="text-sm text-muted-foreground">{a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
