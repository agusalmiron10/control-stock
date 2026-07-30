import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

async function geocode() {
  console.log("Obteniendo clientes de la BD remota...");
  const output = execSync('npx wrangler d1 execute control-stock --remote --command="SELECT id, localidad FROM clientes WHERE activo = 1" --json', { encoding: 'utf-8' });
  
  // The output of wrangler --json might have some warnings before the JSON array. We need to extract the JSON.
  const jsonStr = output.substring(output.indexOf('['), output.lastIndexOf(']') + 1);
  const data = JSON.parse(jsonStr);
  const clientes = data[0].results;

  console.log(`Se encontraron ${clientes.length} clientes. Geocodificando...`);

  const cacheCoords = {};
  let sqlUpdates = "";

  for (const c of clientes) {
    if (!c.localidad) continue;
    
    if (!cacheCoords[c.localidad]) {
      console.log(`Buscando coordenadas para: ${c.localidad}...`);
      const query = encodeURIComponent(`${c.localidad}, Buenos Aires, Argentina`);
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}`;
      
      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'ControlStock-Script' }});
        const resJson = await response.json();
        
        if (resJson.length > 0) {
          cacheCoords[c.localidad] = {
            lat: parseFloat(resJson[0].lat),
            lon: parseFloat(resJson[0].lon)
          };
        } else {
          console.log(`  No se encontró: ${c.localidad}`);
          cacheCoords[c.localidad] = null;
        }
      } catch(e) {
        console.error("Error consultando Nominatim:", e);
        cacheCoords[c.localidad] = null;
      }
      
      // Sleep to respect Nominatim limits
      await new Promise(r => setTimeout(r, 1200));
    }

    const coords = cacheCoords[c.localidad];
    if (coords) {
      // Add slight randomness (approx 100-200 meters) to avoid overlapping pins for clients in the exact same locality
      const rLat = (Math.random() - 0.5) * 0.004;
      const rLon = (Math.random() - 0.5) * 0.004;
      sqlUpdates += `UPDATE clientes SET latitud = ${coords.lat + rLat}, longitud = ${coords.lon + rLon} WHERE id = '${c.id}';\n`;
    }
  }

  writeFileSync('update_real_coords.sql', sqlUpdates);
  console.log("Archivo SQL generado. Ejecutando en BD remota...");
  
  execSync('npx wrangler d1 execute control-stock --remote --file=./update_real_coords.sql', { stdio: 'inherit' });
  console.log("¡Listo! Coordenadas actualizadas con precisión real.");
}

geocode();
