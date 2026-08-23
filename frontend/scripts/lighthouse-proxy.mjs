import http from "node:http";

const port = Number(process.env.LIGHTHOUSE_PORT ?? "4173");
const frontendUrl = new URL(
  process.env.LIGHTHOUSE_FRONTEND_URL ?? "http://127.0.0.1:3000",
);
const backendUrl = new URL(
  process.env.LIGHTHOUSE_BACKEND_URL ?? "http://127.0.0.1:8011",
);

async function waitFor(url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The concurrently-managed upstream is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Lighthouse upstream: ${url}`);
}

await Promise.all([
  waitFor(frontendUrl),
  waitFor(new URL("/api/v1/system/ready/", backendUrl)),
]);

const server = http.createServer((request, response) => {
  const target = request.url?.startsWith("/api/") ? backendUrl : frontendUrl;
  const proxyRequest = http.request(
    new URL(request.url ?? "/", target),
    {
      method: request.method,
      headers: { ...request.headers, host: target.host },
    },
    (proxyResponse) => {
      response.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.headers,
      );
      proxyResponse.pipe(response);
    },
  );
  proxyRequest.on("error", (error) => {
    response.writeHead(502, { "content-type": "text/plain" });
    response.end(`Lighthouse proxy upstream failed: ${error.message}`);
  });
  request.pipe(proxyRequest);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Lighthouse proxy ready at http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close());
}
