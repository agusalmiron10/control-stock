import pandas as pd
import folium
import os

def generar_mapa_clientes(ruta_csv, ruta_salida):
    # 1. Leer los datos
    print(f"Leyendo datos desde {ruta_csv}...")
    try:
        df = pd.read_csv(ruta_csv)
    except FileNotFoundError:
        print("Error: No se encontró el archivo CSV. Verificá la ruta.")
        return

    # Limpiamos filas que no tengan coordenadas por si hubo errores en la geocodificación
    df = df.dropna(subset=['Latitud', 'Longitud'])

    if df.empty:
        print("No hay datos válidos con coordenadas para mostrar en el mapa.")
        return

    # 2. Calcular el centro del mapa dinámicamente (promedio de todas las coordenadas)
    centro_lat = df['Latitud'].mean()
    centro_lon = df['Longitud'].mean()
    
    # Inicializamos el mapa centrado en el punto calculado, con un zoom inicial adecuado
    mapa = folium.Map(location=[centro_lat, centro_lon], zoom_start=12, tiles='cartodb positron')

    # 3. Diccionario para asignar colores según el Rubro (o la variable que elijas)
    colores_rubro = {
        'Ferretería': 'red',
        'Supermercado': 'blue',
        'Dietética': 'green'
    }
    color_por_defecto = 'gray'

    # 4. Iterar sobre los datos y crear marcadores
    for index, fila in df.iterrows():
        # Obtener el color correspondiente al rubro, o el gris por defecto si no está en el diccionario
        color_marcador = colores_rubro.get(fila['Rubro'], color_por_defecto)

        # 5. Crear el contenido del Popup en formato HTML limpio
        popup_html = f"""
        <div style="font-family: Arial, sans-serif; min-width: 200px;">
            <h4 style="margin-bottom: 5px; color: #333;">{fila['Nombre']}</h4>
            <hr style="margin: 5px 0; border-top: 1px solid #ccc;">
            <p style="margin: 2px 0;"><strong>Rubro:</strong> {fila['Rubro']}</p>
            <p style="margin: 2px 0;"><strong>Dirección:</strong> {fila['Direccion']}</p>
            <p style="margin: 2px 0; color: #28a745;"><strong>Ventas:</strong> ${fila['Ventas_Mensuales']:,.2f}</p>
        </div>
        """
        
        # Envolver el HTML para que Folium lo interprete correctamente
        iframe = folium.IFrame(html=popup_html, width=250, height=140)
        popup = folium.Popup(iframe, max_width=250)

        # Agregar el marcador al mapa
        folium.Marker(
            location=[fila['Latitud'], fila['Longitud']],
            popup=popup,
            tooltip=fila['Nombre'], # Texto que aparece al pasar el mouse por encima
            icon=folium.Icon(color=color_marcador, icon='info-sign')
        ).add_to(mapa)

    # 6. Guardar el resultado en un archivo HTML
    mapa.save(ruta_salida)
    print(f"¡Éxito! Mapa generado y guardado en: {ruta_salida}")

if __name__ == "__main__":
    # Nombres de archivos (relativos al directorio actual)
    dir_actual = os.path.dirname(os.path.abspath(__file__))
    ARCHIVO_ENTRADA = os.path.join(dir_actual, 'clientes.csv')
    ARCHIVO_SALIDA = os.path.join(dir_actual, 'mapa_clientes.html')
    
    generar_mapa_clientes(ARCHIVO_ENTRADA, ARCHIVO_SALIDA)
