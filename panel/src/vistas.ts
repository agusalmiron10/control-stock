import type { Negocio, Reporte, EstadoNegocio } from "./tipos";

/** Escape de HTML. Todo lo que venga de la base pasa por acá antes de imprimirse. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function pesos(centavos: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 })
    .format((centavos ?? 0) / 100);
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Días desde una fecha ISO, o null si no hay fecha. */
function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z").getTime();
  if (Number.isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}

const CSS = `
:root{--bg:#0f172a;--panel:#1e293b;--sup:#253449;--borde:#334155;--txt:#e5e7eb;--mut:#94a3b8;
--acento:#3b82f6;--verde:#4ade80;--ambar:#fbbf24;--rojo:#f87171;--mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--acento);text-decoration:none}a:hover{text-decoration:underline}
header{background:#0b1220;padding:12px 20px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--borde)}
header .marca{font-weight:700}header nav{flex:1;display:flex;gap:14px}
main{max-width:1100px;margin:0 auto;padding:24px 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:24px 0 8px}
.card{background:var(--panel);border:1px solid var(--borde);border-radius:10px;padding:16px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th,td{padding:10px;text-align:left;border-bottom:1px solid var(--borde)}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);background:var(--sup)}
td.num,th.num{text-align:right;font-family:var(--mono);white-space:nowrap}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
.b-activo{background:#052e16;color:var(--verde)}.b-prueba{background:#1e3a5f;color:#93c5fd}
.b-suspendido{background:#451a03;color:var(--ambar)}.b-baja{background:#334155;color:var(--mut)}
.mut{color:var(--mut)}.alerta{color:var(--ambar)}.mal{color:var(--rojo)}.bien{color:var(--verde)}
input,select,textarea{font:inherit;width:100%;padding:9px 11px;border:1px solid var(--borde);
border-radius:7px;background:var(--bg);color:var(--txt)}
label{display:block;font-size:13px;color:var(--mut);margin:10px 0 4px}
.btn{display:inline-block;background:var(--acento);color:#fff;border:0;padding:9px 16px;
border-radius:7px;cursor:pointer;font:inherit;font-weight:500}
.btn:hover{filter:brightness(1.1)}
.btn.sec{background:transparent;border:1px solid var(--borde);color:var(--txt)}
.btn.mal{background:#7f1d1d}
.fila{display:flex;gap:12px;flex-wrap:wrap}.fila>*{flex:1;min-width:180px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:var(--panel);border:1px solid var(--borde);border-radius:10px;padding:14px}
.kpi .r{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.kpi .v{font-family:var(--mono);font-size:21px;font-weight:600;margin-top:3px}
.err{background:#450a0a;color:#fecaca;padding:10px 12px;border-radius:8px;margin-bottom:14px}
.ok{background:#052e16;color:#bbf7d0;padding:10px 12px;border-radius:8px;margin-bottom:14px}
.login{max-width:340px;margin:12vh auto}
code{font-family:var(--mono);background:var(--sup);padding:2px 6px;border-radius:5px;font-size:12.5px}
@media(max-width:640px){.tabla-wrap{overflow-x:auto}}
`;

export function pagina(titulo: string, cuerpo: string, opts: { usuario?: string } = {}): string {
  const nav = opts.usuario
    ? `<header><div class="marca">Panel de clientes</div>
         <nav><a href="/">Clientes</a><a href="/nuevo">+ Nuevo cliente</a></nav>
         <span class="mut">${esc(opts.usuario)}</span>
         <form method="post" action="/logout" style="margin:0"><button class="btn sec">Salir</button></form>
       </header>`
    : "";
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><style>${CSS}</style></head>
<body>${nav}<main>${cuerpo}</main></body></html>`;
}

export function vistaLogin(error?: string): string {
  return pagina(
    "Panel — Ingresar",
    `<div class="login"><div class="card">
      <h1>Panel de clientes</h1>
      <p class="mut">Administración de las instalaciones que vendiste.</p>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <form method="post" action="/login">
        <label>Usuario</label><input name="usuario" autofocus autocomplete="username">
        <label>Contraseña</label><input name="password" type="password" autocomplete="current-password">
        <button class="btn" style="width:100%;margin-top:14px">Ingresar</button>
      </form>
    </div></div>`
  );
}

export function vistaSetup(error?: string): string {
  return pagina(
    "Panel — Primer uso",
    `<div class="login"><div class="card">
      <h1>Crear tu acceso</h1>
      <p class="mut">Es la primera vez que se abre el panel. Elegí tu usuario y contraseña.</p>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <form method="post" action="/setup">
        <label>Usuario</label><input name="usuario" autofocus>
        <label>Contraseña (mínimo 8 caracteres)</label><input name="password" type="password">
        <button class="btn" style="width:100%;margin-top:14px">Crear acceso</button>
      </form>
    </div></div>`
  );
}

const ETIQUETA: Record<EstadoNegocio, string> = {
  prueba: "Prueba", activo: "Activo", suspendido: "Suspendido", baja: "Baja",
};

function badge(estado: EstadoNegocio): string {
  return `<span class="badge b-${estado}">${ETIQUETA[estado]}</span>`;
}

/** "Hace 3 días" en color según qué tan desactualizado está el reporte. */
function actividad(fecha: string | null): string {
  const d = diasDesde(fecha);
  if (d === null) return `<span class="mut">Nunca reportó</span>`;
  if (d <= 1) return `<span class="bien">Hoy</span>`;
  if (d <= 7) return `hace ${d} días`;
  return `<span class="${d > 30 ? "mal" : "alerta"}">hace ${d} días</span>`;
}

type FilaLista = Negocio & {
  ultimo_reporte: string | null;
  ventas_mes: number | null;
  ventas_cant: number | null;
};

export function vistaLista(negocios: FilaLista[], usuario: string, aviso?: string): string {
  const activos = negocios.filter((n) => n.estado === "activo").length;
  const prueba = negocios.filter((n) => n.estado === "prueba").length;
  const inactivos = negocios.filter((n) => {
    const d = diasDesde(n.ultimo_reporte);
    return n.estado !== "baja" && (d === null || d > 7);
  }).length;
  const facturado = negocios.reduce((a, n) => a + (n.ventas_mes ?? 0), 0);

  const filas = negocios.length === 0
    ? `<tr><td colspan="6" class="mut" style="padding:24px;text-align:center">
         Todavía no cargaste ningún cliente. <a href="/nuevo">Agregá el primero</a>.</td></tr>`
    : negocios.map((n) => `<tr>
        <td><a href="/negocio/${esc(n.id)}"><b>${esc(n.nombre)}</b></a>
            ${n.contacto ? `<div class="mut">${esc(n.contacto)}</div>` : ""}</td>
        <td>${badge(n.estado)}</td>
        <td>${actividad(n.ultimo_reporte)}</td>
        <td class="num">${n.ventas_mes != null ? pesos(n.ventas_mes) : "—"}</td>
        <td class="num">${n.ventas_cant ?? "—"}</td>
        <td>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td>
      </tr>`).join("");

  return pagina("Panel — Clientes", `
    ${aviso ? `<div class="ok">${esc(aviso)}</div>` : ""}
    <h1>Clientes</h1>
    <p class="mut">${negocios.length} instalación(es) registrada(s).</p>
    <div class="kpis">
      <div class="kpi"><div class="r">Activos</div><div class="v bien">${activos}</div></div>
      <div class="kpi"><div class="r">En prueba</div><div class="v">${prueba}</div></div>
      <div class="kpi"><div class="r">Sin actividad</div><div class="v ${inactivos ? "alerta" : ""}">${inactivos}</div>
        <div class="mut">más de 7 días</div></div>
      <div class="kpi"><div class="r">Facturaron este mes</div><div class="v">${pesos(facturado)}</div>
        <div class="mut">sumando todos</div></div>
    </div>
    <div class="card" style="padding:0">
      <div class="tabla-wrap"><table>
        <thead><tr><th>Negocio</th><th>Estado</th><th>Última señal</th>
          <th class="num">Ventas del mes</th><th class="num">Cant.</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>
    </div>`, { usuario });
}

export function vistaNegocio(
  n: Negocio, reportes: Reporte[], usuario: string, urlPanel: string, aviso?: string
): string {
  const ult = reportes[0];
  const historial = reportes.length === 0
    ? `<tr><td colspan="6" class="mut" style="padding:20px;text-align:center">
         Esta instalación todavía no reportó nada.</td></tr>`
    : reportes.map((r) => `<tr>
        <td class="num">${fechaCorta(r.fecha)}</td>
        <td class="num">${pesos(r.ventas_mes)}</td>
        <td class="num">${r.ventas_cant}</td>
        <td class="num">${r.clientes}</td>
        <td class="num">${r.productos}</td>
        <td class="num">${r.usuarios}</td>
      </tr>`).join("");

  const campo = (l: string, name: string, v: unknown, tipo = "text") =>
    `<div><label>${l}</label><input name="${name}" type="${tipo}" value="${esc(v)}"></div>`;

  return pagina(`Panel — ${n.nombre}`, `
    ${aviso ? `<div class="ok">${esc(aviso)}</div>` : ""}
    <p><a href="/">← Clientes</a></p>
    <h1>${esc(n.nombre)} ${badge(n.estado)}</h1>
    <p class="mut">Alta: ${fechaCorta(n.alta)} · Última señal: ${ult ? fechaCorta(ult.fecha) : "nunca"}</p>

    ${ult ? `<div class="kpis">
      <div class="kpi"><div class="r">Ventas del mes</div><div class="v">${pesos(ult.ventas_mes)}</div>
        <div class="mut">${ult.ventas_cant} ventas</div></div>
      <div class="kpi"><div class="r">Clientes</div><div class="v">${ult.clientes}</div></div>
      <div class="kpi"><div class="r">Productos</div><div class="v">${ult.productos}</div></div>
      <div class="kpi"><div class="r">Usuarios</div><div class="v">${ult.usuarios}</div></div>
    </div>` : `<div class="card mut">Esta instalación todavía no mandó ningún reporte.
      Revisá que tenga configurada la URL del panel y su token.</div>`}

    <h2>Datos</h2>
    <form method="post" action="/negocio/${esc(n.id)}" class="card">
      <div class="fila">${campo("Nombre", "nombre", n.nombre)}${campo("Contacto", "contacto", n.contacto)}</div>
      <div class="fila">${campo("Teléfono", "telefono", n.telefono)}${campo("Email", "email", n.email, "email")}</div>
      <div class="fila">
        ${campo("URL de su instalación", "url", n.url, "url")}
        <div><label>Estado</label><select name="estado">
          ${(["prueba", "activo", "suspendido", "baja"] as EstadoNegocio[])
            .map((e) => `<option value="${e}"${e === n.estado ? " selected" : ""}>${ETIQUETA[e]}</option>`).join("")}
        </select></div>
      </div>
      <label>Notas</label><textarea name="notas" rows="2">${esc(n.notas)}</textarea>
      <button class="btn" style="margin-top:14px">Guardar</button>
    </form>

    <h2>Cómo conectar esta instalación</h2>
    <div class="card">
      <p class="mut" style="margin-top:0">En la app del cliente, en <b>Ajustes → El negocio</b>, cargá estos dos
      valores para que empiece a reportar cada noche:</p>
      <p>URL del panel: <code>${esc(urlPanel)}</code></p>
      <p>Token: <code>${esc(n.token)}</code></p>
      <p class="mut">El token identifica a este negocio. No lo compartas con otro cliente.</p>
    </div>

    <h2>Historial de reportes</h2>
    <div class="card" style="padding:0"><div class="tabla-wrap"><table>
      <thead><tr><th class="num">Fecha</th><th class="num">Ventas del mes</th><th class="num">Cant.</th>
        <th class="num">Clientes</th><th class="num">Productos</th><th class="num">Usuarios</th></tr></thead>
      <tbody>${historial}</tbody>
    </table></div></div>`, { usuario });
}

export function vistaNuevo(usuario: string, error?: string): string {
  return pagina("Panel — Nuevo cliente", `
    <p><a href="/">← Clientes</a></p>
    <h1>Nuevo cliente</h1>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <form method="post" action="/nuevo" class="card">
      <label>Nombre del negocio</label><input name="nombre" autofocus placeholder="Ej: Ferretería El Tornillo">
      <div class="fila">
        <div><label>Persona de contacto</label><input name="contacto"></div>
        <div><label>Teléfono</label><input name="telefono"></div>
      </div>
      <div class="fila">
        <div><label>Email</label><input name="email" type="email"></div>
        <div><label>URL de su instalación</label><input name="url" type="url" placeholder="https://..."></div>
      </div>
      <label>Estado</label>
      <select name="estado"><option value="prueba">Prueba</option><option value="activo">Activo</option></select>
      <label>Notas</label><textarea name="notas" rows="2"></textarea>
      <button class="btn" style="margin-top:14px">Crear cliente</button>
    </form>`, { usuario });
}
