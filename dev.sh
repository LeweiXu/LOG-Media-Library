#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${HOME}/venvs/LOG-venv"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM

  if [[ -n "${BACKEND_PID}" ]]; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID}" ]]; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi

  wait "${BACKEND_PID}" 2>/dev/null || true
  wait "${FRONTEND_PID}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

if [[ ! -f "${VENV_DIR}/bin/activate" ]]; then
  echo "Backend virtual environment not found: ${VENV_DIR}" >&2
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/frontend/node_modules" ]]; then
  echo "Frontend dependencies are missing. Run: cd frontend && npm install" >&2
  exit 1
fi

(
  cd "${ROOT_DIR}/backend"
  source "${VENV_DIR}/bin/activate"
  exec python run.py
) &
BACKEND_PID=$!

(
  cd "${ROOT_DIR}/frontend"
  exec npm start
) &
FRONTEND_PID=$!

echo "Backend and frontend started. Press Ctrl+C to stop both."

wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
