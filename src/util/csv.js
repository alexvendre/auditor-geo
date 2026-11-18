'use strict';
/**
 * Lectura de CSV (RFC 4180: comillas, comillas dobles escapadas y saltos de línea
 * dentro de campos) y de archivos ZIP sin dependencias, para procesar la
 * exportación de datos de LinkedIn tal como se descarga.
 */
const zlib = require('zlib');

function parsearCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  const s = texto.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (comillas) {
      if (ch === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') comillas = true;
    else if (ch === ',') { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(c => c.trim() !== ''));
}

/**
 * Convierte el CSV en objetos usando como cabecera la primera fila que contenga
 * alguna de las columnas esperadas. LinkedIn antepone notas a algunos archivos
 * (Connections.csv empieza con «Notes:»), así que no se puede asumir la fila 1.
 */
function aObjetos(texto, columnasEsperadas = []) {
  const filas = parsearCSV(texto);
  const norm = (x) => x.trim().toLowerCase();
  let idx = 0;
  if (columnasEsperadas.length) {
    const esperadas = columnasEsperadas.map(norm);
    const k = filas.findIndex(f => f.map(norm).filter(c => esperadas.includes(c)).length >= Math.min(2, esperadas.length));
    if (k >= 0) idx = k;
  }
  const cab = (filas[idx] || []).map(c => c.trim());
  return filas.slice(idx + 1).map(f => Object.fromEntries(cab.map((c, i) => [c, (f[i] || '').trim()])));
}

/** Lee un ZIP (sin zip64): devuelve { nombre: Buffer }. */
function leerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No es un ZIP válido');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lNombre = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + lNombre);
    const lNomLocal = buf.readUInt16LE(local + 26);
    const lExtraLocal = buf.readUInt16LE(local + 28);
    const ini = local + 30 + lNomLocal + lExtraLocal;
    const datos = buf.subarray(ini, ini + tamComp);
    if (!nombre.endsWith('/')) {
      if (metodo === 0) out[nombre] = Buffer.from(datos);
      else if (metodo === 8) out[nombre] = zlib.inflateRawSync(datos);
    }
    p += 46 + lNombre + lExtra + lCom;
  }
  return out;
}

module.exports = { parsearCSV, aObjetos, leerZip };
