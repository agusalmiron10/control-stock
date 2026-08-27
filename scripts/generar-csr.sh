#!/usr/bin/env bash
#
# Genera la clave privada y el pedido de certificado (CSR) que hay que subirle
# a ARCA para poder facturar por web service.
#
#   ./scripts/generar-csr.sh <CUIT sin guiones> "<Razón social>" [alias]
#
# Ejemplo:
#   ./scripts/generar-csr.sh 20345678901 "Agustin Almiron" arbell
#
# Deja dos archivos en certificados/:
#   <alias>.key  → la CLAVE PRIVADA. No se le manda a nadie, no se commitea.
#                  Es la que se sube al sistema en Ajustes → Facturación.
#   <alias>.csr  → el pedido. ESTE es el que se sube a ARCA.
#
# ARCA te devuelve un .crt: ese también se sube en Ajustes → Facturación.
set -euo pipefail

CUIT="${1:-}"
RAZON="${2:-}"
ALIAS="${3:-arbell}"

if [[ -z "$CUIT" || -z "$RAZON" ]]; then
  echo "Uso: $0 <CUIT sin guiones> \"<Razón social>\" [alias]" >&2
  exit 1
fi

if [[ ! "$CUIT" =~ ^[0-9]{11}$ ]]; then
  echo "El CUIT tiene que ser 11 dígitos sin guiones ni espacios. Recibí: '$CUIT'" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")/.." && pwd)/certificados"
mkdir -p "$DIR"
chmod 700 "$DIR"

KEY="$DIR/$ALIAS.key"
CSR="$DIR/$ALIAS.csr"

if [[ -e "$KEY" ]]; then
  echo "Ya existe $KEY — no lo piso." >&2
  echo "Si querés uno nuevo, borralo o usá otro alias." >&2
  exit 1
fi

# 2048 bits es lo que pide ARCA. Más corto lo rechaza.
openssl genrsa -out "$KEY" 2048
chmod 600 "$KEY"

# El DN tiene que llevar el CUIT en serialNumber con ese formato exacto:
# si no, ARCA rechaza el pedido sin decir bien por qué.
openssl req -new -key "$KEY" -out "$CSR" \
  -subj "/C=AR/O=$RAZON/CN=$ALIAS/serialNumber=CUIT $CUIT"

echo
echo "Listo."
echo "  Clave privada : $KEY   (secreta — no la compartas ni la subas a git)"
echo "  Pedido (CSR)  : $CSR   (este es el que se sube a ARCA)"
echo
echo "Contenido del CSR para copiar y pegar en ARCA:"
echo "────────────────────────────────────────────────"
cat "$CSR"
