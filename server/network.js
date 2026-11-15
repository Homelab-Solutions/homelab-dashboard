'use strict';

/**
 * IP-/CIDR-Hilfsfunktionen ohne externe Abhaengigkeit (IPv4 + IPv6),
 * inkl. IPv4-mapped IPv6 (z.B. ::ffff:192.168.1.5).
 */

const net = require('net');

function stripZone(ip) {
  const idx = ip.indexOf('%');
  return idx === -1 ? ip : ip.slice(0, idx);
}

/** IPv4-mapped IPv6 auf die reine IPv4-Form reduzieren. */
function normalizeIp(ip) {
  if (!ip) return '';
  const v = stripZone(String(ip).trim());
  const mapped = v.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped && net.isIPv4(mapped[1])) return mapped[1];
  return v;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Erwartet eine normalisierte (volle oder verkuerzte) IPv6-Adresse. */
function ipv6ToBigInt(ip) {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const allParts = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  let result = 0n;
  for (const part of allParts.slice(0, 8)) {
    result = (result << 16n) | BigInt(parseInt(part || '0', 16));
  }
  return result;
}

function parseCidr(entry) {
  const trimmed = String(entry || '').trim();
  if (!trimmed) return null;
  const [addrRaw, prefixRaw] = trimmed.split('/');
  const addr = normalizeIp(addrRaw);
  const family = net.isIP(addr);
  if (!family) return null;
  const maxBits = family === 4 ? 32 : 128;
  const prefix = prefixRaw === undefined ? maxBits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) return null;
  return {
    family,
    prefix,
    network: family === 4 ? ipv4ToInt(addr) : ipv6ToBigInt(addr),
  };
}

/** Kommagetrennte Liste von CIDR-Angaben (oder einzelnen IPs) parsen. */
function parseCidrList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => parseCidr(entry))
    .filter(Boolean);
}

function isIpInCidr(ip, cidr) {
  const addr = normalizeIp(ip);
  const family = net.isIP(addr);
  if (!family || family !== cidr.family) return false;
  if (family === 4) {
    const ipInt = ipv4ToInt(addr);
    const mask = cidr.prefix === 0 ? 0 : (0xffffffff << (32 - cidr.prefix)) >>> 0;
    return (ipInt & mask) === (cidr.network & mask);
  }
  const ipBig = ipv6ToBigInt(addr);
  const mask =
    cidr.prefix === 0 ? 0n : ((1n << BigInt(cidr.prefix)) - 1n) << BigInt(128 - cidr.prefix);
  return (ipBig & mask) === (cidr.network & mask);
}

function isIpInList(ip, cidrList) {
  if (!ip || !Array.isArray(cidrList) || !cidrList.length) return false;
  return cidrList.some((cidr) => isIpInCidr(ip, cidr));
}

/** Erste Adresse aus einem X-Forwarded-For-Header (der urspruengliche Client). */
function firstForwardedIp(headerValue) {
  if (!headerValue) return null;
  const first = String(headerValue).split(',')[0].trim();
  return first || null;
}

/**
 * Tatsaechliche Client-IP ermitteln: X-Forwarded-For wird nur ausgewertet,
 * wenn die verbindende Socket-Adresse in trustedProxies steht - sonst zaehlt
 * ausschliesslich die Socket-IP (Schutz vor gefaelschtem Header).
 */
function resolveRequestIp(req, trustedProxies) {
  const socketIp = normalizeIp(req.socket && req.socket.remoteAddress);
  if (isIpInList(socketIp, trustedProxies)) {
    const forwarded = firstForwardedIp(req.headers['x-forwarded-for']);
    if (forwarded) return normalizeIp(forwarded);
  }
  return socketIp;
}

/**
 * Ob die Anfrage als HTTPS gilt: direkt per TLS oder - nur von einem
 * vertrauenswuerdigen Proxy aus - per X-Forwarded-Proto.
 */
function resolveRequestSecure(req, trustedProxies) {
  if (req.socket && req.socket.encrypted) return true;
  const socketIp = normalizeIp(req.socket && req.socket.remoteAddress);
  if (isIpInList(socketIp, trustedProxies)) {
    const proto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return proto === 'https';
  }
  return false;
}

module.exports = {
  normalizeIp,
  parseCidrList,
  isIpInCidr,
  isIpInList,
  resolveRequestIp,
  resolveRequestSecure,
};
