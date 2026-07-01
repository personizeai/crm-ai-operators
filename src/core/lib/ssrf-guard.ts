import { promises as dns } from "node:dns";

/** IPv4: loopback, private RFC-1918, link-local, CGNAT, "this" network */
export function isPrivateIpv4(addr: string): boolean {
  if (addr === "0.0.0.0") return true;
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** IPv6: loopback, unspecified, ULA (fc/fd), link-local (fe80::/10), IPv4-mapped/compatible */
export function isPrivateIpv6(addr: string): boolean {
  const a = addr.toLowerCase().split("%")[0]; // strip zone ID
  if (a === "::1" || a === "::") return true;
  if (a.startsWith("fc") || a.startsWith("fd")) return true; // ULA fc00::/7
  // fe80::/10 link-local: second byte 0x80..0xbf → prefix fe8_/fe9_/fea_/feb_
  if (a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb")) return true;
  // IPv4-mapped ::ffff:x.x.x.x or IPv4-compatible ::x.x.x.x
  const v4 = a.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) return isPrivateIpv4(v4[1]);
  return false;
}

/** Resolve hostname and block if ANY returned address is private. Fails closed on DNS error. */
export async function isHostPrivate(hostname: string): Promise<boolean> {
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    return addresses.some((entry) =>
      entry.family === 4 ? isPrivateIpv4(entry.address) : isPrivateIpv6(entry.address),
    );
  } catch {
    return true; // DNS failure → fail closed
  }
}
