import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import {
  checkProxyExitIp,
  formatHostForUrl,
  normalizeProxyHost,
} from "./proxy-check";
import type { EvolutionProxyConfig } from "./proxy-pool";

/**
 * IPv6 em URL exige colchetes. Sem isso o `new URL()` — e portanto o
 * ProxyAgent do undici — lança ERR_INVALID_URL, e a checagem de saúde
 * falharia em TODO proxy IPv6. Importa porque os proxies residenciais
 * brasileiros vendidos para WhatsApp são majoritariamente IPv6.
 */
describe("formatHostForUrl / normalizeProxyHost", () => {
  it("bracketa IPv6 e monta uma URL válida", () => {
    expect(formatHostForUrl("2804:abc::1")).toBe("[2804:abc::1]");
    const u = new URL(`http://user:pass@${formatHostForUrl("2804:abc::1")}:8080`);
    expect(u.port).toBe("8080");
  });

  it("não mexe em IPv4 nem em hostname", () => {
    expect(formatHostForUrl("191.96.1.10")).toBe("191.96.1.10");
    expect(formatHostForUrl("proxy.exemplo.com.br")).toBe("proxy.exemplo.com.br");
  });

  it("é idempotente — IPv6 já bracketado não duplica colchete", () => {
    expect(formatHostForUrl("[2804:abc::1]")).toBe("[2804:abc::1]");
  });

  it("normaliza para a forma canônica (sem colchetes) ao gravar", () => {
    expect(normalizeProxyHost("[2804:abc::1]")).toBe("2804:abc::1");
    expect(normalizeProxyHost("  2804:abc::1  ")).toBe("2804:abc::1");
    expect(normalizeProxyHost("191.96.1.10")).toBe("191.96.1.10");
    expect(normalizeProxyHost("proxy.exemplo.com.br")).toBe(
      "proxy.exemplo.com.br",
    );
  });

  it("não mutila um valor entre colchetes que não é IPv6", () => {
    expect(normalizeProxyHost("[nao-e-ipv6]")).toBe("[nao-e-ipv6]");
  });

  it("normalizar e formatar de volta devolve o original (ida e volta)", () => {
    const canonico = normalizeProxyHost("[2804:abc::1]");
    expect(formatHostForUrl(canonico)).toBe("[2804:abc::1]");
  });
});

/**
 * Regressão de um bug real: `checkProxyExitIp` tinha que usar o
 * `fetch` do próprio pacote `undici`, não o `fetch` global do Node. O
 * fetch global embute sua própria cópia interna do undici (outra
 * major da instalada via npm): passar um `ProxyAgent` de uma
 * instância da lib pro fetch de outra falhava SEMPRE com
 * `TypeError: fetch failed` / `UND_ERR_INVALID_ARG`, mesmo com o
 * proxy saudável, o que fazia `result.ok` ser sempre `false` e a
 * detecção de vazamento nunca rodar.
 *
 * O teste abaixo não usa nenhum mock de rede: sobe um proxy HTTP
 * CONNECT real (`http.createServer` + evento `connect`, encaminhando
 * bytes crus via `net.connect`) e um servidor de echo real, exatamente
 * como a Evolution/undici veem um proxy de verdade. Se alguém trocar
 * o `fetch` do undici de volta pelo global, este teste falha.
 */

/** Sobe um proxy HTTP CONNECT real numa porta efêmera de loopback. */
async function startConnectProxy(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = http.createServer((_req, res) => {
    // Só atende CONNECT; qualquer outro método não é usado aqui.
    res.writeHead(405);
    res.end();
  });

  server.on("connect", (req, clientSocket, head) => {
    const [host, portStr] = (req.url ?? "").split(":");
    const port = Number(portStr) || 80;
    const serverSocket = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
    serverSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => serverSocket.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Sobe um servidor de echo real que responde um corpo fixo em texto puro. */
async function startEchoServer(body: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("checkProxyExitIp (proxy real, sem mock de rede)", () => {
  it(
    "retorna ok:true e o IP de saída correto através de um proxy HTTP CONNECT real",
    async () => {
      const FAKE_EXIT_IP = "203.0.113.42";
      const echo = await startEchoServer(FAKE_EXIT_IP);
      const proxy = await startConnectProxy();

      try {
        const config: EvolutionProxyConfig = {
          host: "127.0.0.1",
          port: proxy.port,
          protocol: "http",
          username: "",
          password: "",
        };

        const result = await checkProxyExitIp(config, 5_000, echo.url);

        expect(result.error).toBeUndefined();
        expect(result.ok).toBe(true);
        expect(result.exitIp).toBe(FAKE_EXIT_IP);
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      } finally {
        await echo.close();
        await proxy.close();
      }
    },
    10_000,
  );

  it(
    "rejeita como falha um corpo de echo que não parece um IP (captive portal / lixo)",
    async () => {
      const echo = await startEchoServer("<html>captive portal</html>");
      const proxy = await startConnectProxy();

      try {
        const config: EvolutionProxyConfig = {
          host: "127.0.0.1",
          port: proxy.port,
          protocol: "http",
          username: "",
          password: "",
        };

        const result = await checkProxyExitIp(config, 5_000, echo.url);

        expect(result.ok).toBe(false);
        expect(result.exitIp).toBeNull();
        expect(result.error).toMatch(/não parece um IP/);
      } finally {
        await echo.close();
        await proxy.close();
      }
    },
    10_000,
  );
});
