import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { compile } from "../src/compile.js";
import { Gateway, Upstream } from "../src/components.js";
import { Group } from "@johnhenry/servable";

async function withBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await run(`http://localhost:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("url= strips the accumulated Group prefix before forwarding", async () => {
  await withBackend(
    (req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`saw ${req.url}`);
    },
    async (baseUrl) => {
      const tree = Gateway({ children: Group({ prefix: "/api", children: Upstream({ path: "/*", url: `${baseUrl}/` }) }) });
      const compiled = await compile(tree);
      const res = await compiled.fetch(new Request("http://x/api/users/1?q=2"));
      assert.equal(await res.text(), "saw /users/1?q=2");
    },
  );
});

test("url= forwards method and request body", async () => {
  await withBackend(
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(`${req.method} ${Buffer.concat(chunks).toString()}`);
      });
    },
    async (baseUrl) => {
      const tree = Gateway({ children: Upstream({ path: "/*", url: `${baseUrl}/` }) });
      const compiled = await compile(tree);
      const res = await compiled.fetch(new Request("http://x/echo", { method: "POST", body: "hello" }));
      assert.equal(await res.text(), "POST hello");
    },
  );
});

test("url= strips hop-by-hop headers from both the outgoing request and the returned response", async () => {
  // `connection` specifically is NOT usable for this check -- verified
  // directly that Node's own fetch() (undici) sets `connection: keep-alive`
  // on every outgoing request at the transport level regardless of what's
  // passed in `headers`, so a client-supplied `connection` header being
  // absent server-side wouldn't prove anything about *our* stripping logic.
  // `te`/`trailer` aren't transport-managed the same way (verified the same
  // way), so they're what this test actually checks on the request side.
  await withBackend(
    (req, res) => {
      res.writeHead(200, {
        "content-type": "text/plain",
        connection: "keep-alive", // hop-by-hop -- must not reach the client
        "x-real": "1", // a normal header -- must reach the client
      });
      res.end(req.headers.te ? "had-te-header" : "no-te-header");
    },
    async (baseUrl) => {
      const tree = Gateway({ children: Upstream({ path: "/*", url: `${baseUrl}/` }) });
      const compiled = await compile(tree);
      const res = await compiled.fetch(new Request("http://x/x", { headers: { te: "trailers" } }));
      assert.equal(await res.text(), "no-te-header");
      assert.equal(res.headers.get("connection"), null);
      assert.equal(res.headers.get("x-real"), "1");
    },
  );
});

test("<Upstream> with no `method` set forwards every standard HTTP method, not just GET", async () => {
  await withBackend(
    (req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`saw ${req.method}`);
    },
    async (baseUrl) => {
      const tree = Gateway({ children: Upstream({ path: "/*", url: `${baseUrl}/` }) });
      const compiled = await compile(tree);
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const res = await compiled.fetch(new Request("http://x/x", { method }));
        assert.equal(await res.text(), `saw ${method}`);
      }
    },
  );
});

test("url= passes redirects through unfollowed (redirect: manual)", async () => {
  await withBackend(
    (req, res) => {
      res.writeHead(302, { location: "/elsewhere" });
      res.end();
    },
    async (baseUrl) => {
      const tree = Gateway({ children: Upstream({ path: "/*", url: `${baseUrl}/` }) });
      const compiled = await compile(tree);
      const res = await compiled.fetch(new Request("http://x/x"));
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/elsewhere");
    },
  );
});

test('url="ipfs://<cid>/<path>" (EXAMPLE) reverse-proxies through the configured gateway, Group prefix stripped first', async () => {
  // Real public IPFS gateways (ipfs.io, dweb.link, w3s.link, nftstorage.link)
  // currently 429 direct server-side fetches (migrating to service-worker-only
  // access) -- verified directly via curl, same finding fileable's and
  // servable's own ipfs:// tests are built around. A real local node:http
  // server stands in for the gateway here for the same reason.
  const CID = "bafyhostabletest";
  await withBackend(
    (req, res) => {
      if (req.url === `/ipfs/${CID}/logo.png`) {
        res.writeHead(200, { "content-type": "image/png" });
        res.end("fake-png-bytes");
        return;
      }
      res.writeHead(404);
      res.end();
    },
    async (baseUrl) => {
      const tree = Gateway({
        children: Group({ prefix: "/assets", children: Upstream({ path: "/*", url: `ipfs://${CID}` }) }),
      });
      const compiled = await compile(tree, { ipfsGateway: `${baseUrl}/ipfs/` });
      const res = await compiled.fetch(new Request("http://x/assets/logo.png"));
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type")!, /image\/png/);
      assert.equal(await res.text(), "fake-png-bytes");
    },
  );
});

test('url="ipfs://<cid>/<base>" (EXAMPLE) joins a fixed base path with the forwarded request path', async () => {
  const CID = "bafyhostabletest2";
  await withBackend(
    (req, res) => {
      if (req.url === `/ipfs/${CID}/site/deep/file.txt`) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("deep file");
        return;
      }
      res.writeHead(404);
      res.end();
    },
    async (baseUrl) => {
      const tree = Gateway({ children: Upstream({ path: "/*", url: `ipfs://${CID}/site` }) });
      const compiled = await compile(tree, { ipfsGateway: `${baseUrl}/ipfs/` });
      const res = await compiled.fetch(new Request("http://x/deep/file.txt"));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "deep file");
    },
  );
});

test('url="ipfs://..." (EXAMPLE) surfaces a real gateway error (e.g. missing CID) as-is, not swallowed', async () => {
  await withBackend(
    (_req, res) => {
      res.writeHead(404);
      res.end();
    },
    async (baseUrl) => {
      const tree = Gateway({ children: Upstream({ path: "/*", url: "ipfs://nope" }) });
      const compiled = await compile(tree, { ipfsGateway: `${baseUrl}/ipfs/` });
      const res = await compiled.fetch(new Request("http://x/missing.png"));
      assert.equal(res.status, 404);
    },
  );
});

test("<Upstream> throws if more than one of url/app/handler is set", async () => {
  const tree = Gateway({ children: Upstream({ path: "/*", url: "http://x", handler: async () => new Response("x") }) });
  await assert.rejects(() => compile(tree));
});

test("<Upstream> throws if none of url/app/handler is set", async () => {
  const tree = Gateway({ children: Upstream({ path: "/*" }) });
  await assert.rejects(() => compile(tree));
});
