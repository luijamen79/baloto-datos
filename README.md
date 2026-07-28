# 🤖 Actualización automática de Baloto Quantum (v2)

## Por qué el método anterior nunca iba a funcionar

La app raspaba páginas web **desde el navegador de tu celular**. Eso obliga a pasar por
proxies CORS públicos (allorigins, corsproxy). Esos proxies:

- se caen sin aviso,
- limitan peticiones por IP,
- y **sirven copias en caché con días de retraso** — por eso veías datos de abril
  cuando ya era mayo.

Además, cuando la página cambia su HTML, los patrones se rompen en silencio.

## La solución

Sacar el raspado del navegador y ponerlo en un servidor que corre solo.

```
GitHub Actions (LUN·MIE·SAB 23:50 hora Colombia)
        │  raspa 4 fuentes · sin CORS · sin proxies
        ▼
   baloto.json  ──►  raw.githubusercontent.com
                          │  access-control-allow-origin: *
                          ▼
                    Tu app lo lee DIRECTO
```

El robot corre **aunque tengas el celular apagado**. Cuando abres la app, ya está todo ahí.

---

## Instalación — 6 pasos, una sola vez

### 1. Crea el repositorio
Entra a [github.com/new](https://github.com/new).
Nombre: `baloto-datos`. Marca **Public**. Crear.

> Debe ser público: `raw.githubusercontent.com` solo sirve archivos de repos públicos
> sin autenticación. El repo contiene únicamente números de lotería ya publicados.

### 2. Sube los archivos
Arrastra al repositorio:

```
scraper.mjs
baloto.json
.github/workflows/actualizar-baloto.yml
```

> Si la interfaz web no te deja crear carpetas al arrastrar: usa **Add file → Create new file**
> y escribe la ruta completa `.github/workflows/actualizar-baloto.yml` en el nombre.
> Al escribir `/` GitHub crea las carpetas solo.

### 3. Da permiso de escritura al robot
**Settings → Actions → General → Workflow permissions**
→ marca **Read and write permissions** → **Save**.

Sin esto el robot puede leer pero no guardar los resultados.

### 4. Primera ejecución manual
Pestaña **Actions** → *Actualizar resultados Baloto* → **Run workflow**.
Tarda un minuto. Al terminar debe aparecer un commit nuevo tipo `Sorteo 2026-XX-XX · N en total`.

### 5. Copia la URL raw
Abre `baloto.json` en el repo → botón **Raw** → copia la URL de la barra de direcciones.
Queda así:

```
https://raw.githubusercontent.com/TU_USUARIO/baloto-datos/main/baloto.json
```

### 6. Pégala en la app
Abre Baloto Quantum → pestaña **🎯 SORTEOS** → recuadro **⚡ Sincronización automática**
→ pega la URL → **Guardar y probar**.

Si dice `✅ Conectado`, ya está. La app sincroniza sola cada vez que la abres.

---

## Cómo saber que está funcionando

- En **Actions** ves una ejecución verde cada lunes, miércoles y sábado.
- El archivo `baloto.json` cambia de fecha en cada sorteo.
- Al abrir la app aparece la insignia dorada de actualización.

## Si una fuente se cae

El scraper consulta **cuatro** sitios y fusiona lo que consiga. Con que uno responda, funciona.
Si fallan todos, la ejecución queda marcada en rojo en Actions y verás el motivo en el resumen —
no falla en silencio como antes.

## Horario

| Cron (UTC) | Hora Colombia | Cuándo |
|---|---|---|
| `50 4 * * 2,4,0` | 23:50 LUN·MIE·SAB | 45 min después del sorteo |
| `50 7 * * 2,4,0` | 02:50 MAR·JUE·DOM | reintento por si alguna fuente tardó |

> GitHub puede retrasar los cron unos minutos cuando hay mucha carga. No pasa nada:
> el segundo intento cubre ese caso.

---

## Red de seguridad: importar pegando

Aunque nunca instales el robot, la app trae un importador universal en la misma pestaña.
Copias el texto de **cualquier** página de resultados, lo pegas y él extrae fechas y números.

Funciona sin internet, sin CORS y con formatos muy distintos:

```
25/05/2026  12-14-37-38-39-16
2026-05-25  12 14 37 38 39 16
Fecha: 25 de mayo de 2026 · Resultados: 12 - 14 - 37 - 38 - 39 - 16
```

Incluso aguanta texto sucio con precios y publicidad alrededor: descarta los números
que estén demasiado lejos de la fecha y se queda con el bloque compacto.
