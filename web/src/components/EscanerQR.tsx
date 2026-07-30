import { useEffect, useRef, useState } from "react";

/** true sólo en navegadores con BarcodeDetector nativo (no existe en Safari
 * de iOS al día de hoy) — quien lo llame debe esconder el botón si es false. */
export function hayEscanerQr(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** Escáner de QR con la cámara trasera. Sólo se monta si hayEscanerQr(). */
export function EscanerQR({ onDetectar, onCerrar }: { onDetectar: (texto: string) => void; onCerrar: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    let stream: MediaStream | null = null;
    let raf = 0;

    async function iniciar() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!activo) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = (window as any).BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code"] });

        const tick = async () => {
          if (!activo || !videoRef.current) return;
          try {
            const codigos = await detector.detect(videoRef.current);
            if (codigos.length > 0) {
              onDetectar(codigos[0].rawValue);
              return;
            }
          } catch {
            // frame todavía no listo — seguimos intentando.
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError("No se pudo acceder a la cámara. Revisá los permisos.");
      }
    }
    iniciar();

    return () => {
      activo = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="qr-escaner-overlay" onClick={onCerrar}>
      <div className="qr-escaner-caja" onClick={(e) => e.stopPropagation()}>
        {error ? <p className="error-box">{error}</p> : <video ref={videoRef} muted playsInline className="qr-escaner-video" />}
        <button className="btn" onClick={onCerrar}>Cancelar</button>
      </div>
    </div>
  );
}
