import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIpv4, isPrivateIpv6 } from "../core/lib/ssrf-guard.js";

describe("isPrivateIpv4", () => {
  // --- Blocked ranges ---
  test("loopback 127.0.0.1", () => assert.equal(isPrivateIpv4("127.0.0.1"), true));
  test("loopback 127.255.255.255", () => assert.equal(isPrivateIpv4("127.255.255.255"), true));
  test("RFC-1918 10.0.0.1", () => assert.equal(isPrivateIpv4("10.0.0.1"), true));
  test("RFC-1918 10.255.255.255", () => assert.equal(isPrivateIpv4("10.255.255.255"), true));
  test("RFC-1918 172.16.0.1", () => assert.equal(isPrivateIpv4("172.16.0.1"), true));
  test("RFC-1918 172.31.255.255", () => assert.equal(isPrivateIpv4("172.31.255.255"), true));
  test("RFC-1918 192.168.0.1", () => assert.equal(isPrivateIpv4("192.168.0.1"), true));
  test("link-local 169.254.0.1", () => assert.equal(isPrivateIpv4("169.254.0.1"), true));
  test("link-local 169.254.169.254 (AWS IMDS)", () => assert.equal(isPrivateIpv4("169.254.169.254"), true));
  test("unspecified 0.0.0.0", () => assert.equal(isPrivateIpv4("0.0.0.0"), true));
  test("this-network 0.1.2.3", () => assert.equal(isPrivateIpv4("0.1.2.3"), true));
  test("CGNAT 100.64.0.1", () => assert.equal(isPrivateIpv4("100.64.0.1"), true));
  test("CGNAT 100.127.255.255", () => assert.equal(isPrivateIpv4("100.127.255.255"), true));

  // fail-closed on invalid input
  test("invalid string fails closed", () => assert.equal(isPrivateIpv4("not-an-ip"), true));
  test("partial octets fails closed", () => assert.equal(isPrivateIpv4("10.0.1"), true));
  test("octet out of range fails closed", () => assert.equal(isPrivateIpv4("256.0.0.1"), true));

  // --- Allowed public ranges ---
  test("public 8.8.8.8", () => assert.equal(isPrivateIpv4("8.8.8.8"), false));
  test("public 1.1.1.1", () => assert.equal(isPrivateIpv4("1.1.1.1"), false));
  test("172.15.255.255 (just below RFC-1918)", () => assert.equal(isPrivateIpv4("172.15.255.255"), false));
  test("172.32.0.0 (just above RFC-1918)", () => assert.equal(isPrivateIpv4("172.32.0.0"), false));
  test("100.63.255.255 (just below CGNAT)", () => assert.equal(isPrivateIpv4("100.63.255.255"), false));
  test("100.128.0.0 (just above CGNAT)", () => assert.equal(isPrivateIpv4("100.128.0.0"), false));
  test("169.253.255.255 (just below link-local)", () => assert.equal(isPrivateIpv4("169.253.255.255"), false));
  test("169.255.0.1 (just above link-local)", () => assert.equal(isPrivateIpv4("169.255.0.1"), false));
});

describe("isPrivateIpv6", () => {
  // --- Blocked ranges ---
  test("loopback ::1", () => assert.equal(isPrivateIpv6("::1"), true));
  test("unspecified ::", () => assert.equal(isPrivateIpv6("::"), true));
  test("ULA fc00::1", () => assert.equal(isPrivateIpv6("fc00::1"), true));
  test("ULA fd12:3456::1", () => assert.equal(isPrivateIpv6("fd12:3456::1"), true));
  test("link-local fe80::1", () => assert.equal(isPrivateIpv6("fe80::1"), true));
  test("link-local fe80::1 with zone id stripped", () => assert.equal(isPrivateIpv6("fe80::1%eth0"), true));
  test("link-local fe90::1", () => assert.equal(isPrivateIpv6("fe90::1"), true));
  test("link-local fea0::1", () => assert.equal(isPrivateIpv6("fea0::1"), true));
  test("link-local feb0::1", () => assert.equal(isPrivateIpv6("feb0::1"), true));
  test("link-local febf::1 (last in range)", () => assert.equal(isPrivateIpv6("febf::1"), true));
  test("IPv4-mapped loopback ::ffff:127.0.0.1", () => assert.equal(isPrivateIpv6("::ffff:127.0.0.1"), true));
  test("IPv4-mapped AWS IMDS ::ffff:169.254.169.254", () => assert.equal(isPrivateIpv6("::ffff:169.254.169.254"), true));
  test("IPv4-compatible loopback ::127.0.0.1", () => assert.equal(isPrivateIpv6("::127.0.0.1"), true));

  // --- Allowed public ranges ---
  test("public 2001:db8::1", () => assert.equal(isPrivateIpv6("2001:db8::1"), false));
  test("public 2606:4700:4700::1111 (Cloudflare DNS)", () => assert.equal(isPrivateIpv6("2606:4700:4700::1111"), false));
  test("fec0::1 (just outside fe80::/10)", () => assert.equal(isPrivateIpv6("fec0::1"), false));
  test("fe00::1 (not in any private range)", () => assert.equal(isPrivateIpv6("fe00::1"), false));
});
