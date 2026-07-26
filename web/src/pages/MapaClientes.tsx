import { useMemo } from "react";
import { api } from "../api";
import { useCarga, Cargando, Error } from "../components/ui";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { pesos } from "../format";
import { navegar } from "../lib/router";

// Fix for default marker icons in Leaflet with bundlers
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

export function MapaClientes() {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/clientes`), []);

  const { clientesConCoords, centro } = useMemo(() => {
    if (!data?.clientes) return { clientesConCoords: [], centro: [-34.6037, -58.3816] }; // default CABA
    
    const validos = data.clientes.filter((c: any) => c.latitud != null && c.longitud != null);
    
    let centro: [number, number] = [-34.6037, -58.3816];
    if (validos.length > 0) {
      const sumLat = validos.reduce((acc: number, c: any) => acc + Number(c.latitud), 0);
      const sumLon = validos.reduce((acc: number, c: any) => acc + Number(c.longitud), 0);
      centro = [sumLat / validos.length, sumLon / validos.length];
    }
    
    return { clientesConCoords: validos, centro };
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="encabezado-seccion">
        <h1>Mapa de Clientes</h1>
      </div>

      {error && <Error msg={error} />}
      
      {cargando ? (
        <Cargando />
      ) : (
        <div className="card" style={{ flex: 1, minHeight: "500px", padding: 0, overflow: "hidden" }}>
          {clientesConCoords.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--mut)" }}>
              No hay clientes con coordenadas configuradas. Editá la ficha de tus clientes para agregar su Latitud y Longitud.
            </div>
          ) : (
            <MapContainer 
              center={centro as [number, number]} 
              zoom={12} 
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              />
              
              {clientesConCoords.map((c: any) => (
                <Marker 
                  key={c.id} 
                  position={[Number(c.latitud), Number(c.longitud)]}
                >
                  <Popup>
                    <div style={{ minWidth: "200px" }}>
                      <h4 style={{ margin: "0 0 5px 0" }}>{c.nombre}</h4>
                      {c.localidad && <p style={{ margin: "2px 0", fontSize: "0.9em", color: "#666" }}>{c.localidad}</p>}
                      <hr style={{ margin: "8px 0", borderTop: "1px solid #ccc" }} />
                      <p style={{ margin: "2px 0" }}>
                        <strong>Saldo: </strong> 
                        <span className={c.saldo > 0 ? "debe" : c.saldo < 0 ? "afavor" : ""}>
                          {c.saldo < 0 ? `${pesos(-c.saldo)} a favor` : pesos(c.saldo)}
                        </span>
                      </p>
                      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                        <button 
                          className="btn chico primario" 
                          style={{ flex: 1 }}
                          onClick={() => navegar(`/clientes/${c.id}`)}
                        >
                          Ver ficha
                        </button>
                        <a 
                          href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitud},${c.longitud}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="btn chico"
                          style={{ flex: 1, textAlign: "center", textDecoration: "none" }}
                        >
                          Cómo llegar 📍
                        </a>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          )}
        </div>
      )}
    </div>
  );
}
