import { useCallback, useState } from "react";
import { ACTIONS, EVENTS, Joyride, STATUS, type Controls, type EventData, type Step } from "react-joyride";
import { navegar } from "../lib/router";
import { claveTourVisto } from "../lib/tour";

/**
 * Recorrido guiado de la primera vez. Estructura básica: pensado para
 * ampliarse con más pasos (nueva venta, facturación, etc.) agregando
 * entradas a PASOS — cada una puede llevar una `ruta` propia, y el tour
 * navega solo antes de mostrar ese paso.
 */
interface PasoTour extends Step {
  /** Si el paso vive en otra pantalla, el tour navega ahí antes de mostrarlo. */
  ruta?: string;
}

const PASOS: PasoTour[] = [
  {
    target: "body",
    placement: "center",
    title: "Bienvenido a ChauPapel 👋",
    content: "Te mostramos en un par de pasos cómo cargar tu primer producto. Podés saltear el recorrido cuando quieras.",
  },
  {
    target: '[data-tour="nueva-herramienta"]',
    ruta: "/herramientas",
    title: "Cargá tu primer producto",
    content: "Tocá acá para dar de alta un producto: código, nombre, precio y stock. Desde este mismo botón vas a cargar todo tu catálogo.",
  },
  {
    target: "body",
    placement: "center",
    title: "Eso es todo por ahora",
    content: "El resto de las secciones se explican solas — cualquier duda, el botón de WhatsApp de soporte está siempre en Ajustes.",
  },
];

/**
 * App.tsx ya decidió, con tourYaVisto() (sin bajar este chunk), que este
 * usuario todavía no lo vio — así que sólo lo monta cuando corresponde
 * mostrarlo. Acá adentro alcanza con arrancar corriendo directamente.
 */
export function TourInicial({ negocioId, usuario }: { negocioId: string; usuario: string }) {
  const clave = claveTourVisto(negocioId, usuario);
  const [correr, setCorrer] = useState(true);
  const [paso, setPaso] = useState(0);

  const terminar = useCallback(() => {
    setCorrer(false);
    setPaso(0);
    try {
      localStorage.setItem(clave, "1");
    } catch {
      // Si no se puede guardar, en la próxima sesión vuelve a aparecer —
      // molesto pero no rompe nada.
    }
  }, [clave]);

  const alEvento = useCallback(
    (data: EventData, _controls: Controls) => {
      const { status, action, index, type } = data;

      if (status === STATUS.FINISHED || status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
        terminar();
        return;
      }
      // El target del paso siguiente puede estar en otra pantalla: si no
      // apareció (por ejemplo, se navegó pero el componente todavía no
      // montó), saltear ese paso en vez de dejar el tour trabado.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        setPaso((p) => Math.min(p + 1, PASOS.length - 1));
        return;
      }
      if (type === EVENTS.STEP_AFTER) {
        const siguiente = index + (action === ACTIONS.PREV ? -1 : 1);
        const pasoSiguiente = PASOS[siguiente];
        if (pasoSiguiente?.ruta) {
          navegar(pasoSiguiente.ruta);
          // Le da un instante a la pantalla nueva para montar el elemento
          // objetivo antes de que Joyride lo busque.
          setTimeout(() => setPaso(siguiente), 120);
        } else {
          setPaso(siguiente);
        }
      }
    },
    [terminar]
  );

  if (!correr) return null;

  return (
    <Joyride
      steps={PASOS}
      run={correr}
      stepIndex={paso}
      continuous
      onEvent={alEvento}
      locale={{ back: "Atrás", close: "Cerrar", last: "Listo", next: "Siguiente", skip: "Saltar" }}
      options={{
        primaryColor: "#2563eb",
        zIndex: 10000,
        skipBeacon: true,
        buttons: ["back", "skip", "primary"],
      }}
    />
  );
}
