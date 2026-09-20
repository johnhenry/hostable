import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocketServer } from "ws";
import { Server, Agent } from "@johnhenry/dialback";
import { toWebRequest } from "@johnhenry/leserve/node-request";
import { compile } from "../src/compile.js";
import { Gateway, Upstream } from "../src/components.js";

async function withDialbackTunnel(
  agentHandler: (req: Request) => Response | Promise<Response>,
  run: (server: Server) => Promise<void>,
): Promise<void> {
  const server = new Server(async () => new Response("no responder", { status: 500 }), { allowUnauthenticatedAgents: true });
  // dialback's own Server#fetch requires a real Request instance (verified
  // by reading server.mjs's unBoundFetch -- it throws on anything that
  // isn't `instanceof Request` or a string, so a raw Node IncomingMessage
  // doesn't work despite dialback's own README example passing one
  // directly). leserve's toWebRequest() already solves the real
  // IncomingMessage -> Request bridge correctly; reuse it instead of
  // hand-rolling the same conversion here.
  const httpServer = http.createServer(async (req, res) => {
    const response = await server.fetch(toWebRequest(req));
    res.writeHead(response.status, response.statusText, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws) => {
    server.addConnection(ws as never);
    ws.on("close", () => server.removeConnection(ws as never));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as { port: number }).port;

  const agent = new Agent(`ws://localhost:${port}`, {});
  agent.serve(async (request: Request) => agentHandler(request));
  await agent.connection; // real tunnel established before proceeding

  try {
    await run(server);
  } finally {
    await agent.close();
    wss.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

test("<Upstream app={dialback.Server}> forwards a real HTTP request through a real tunnel to a connected Agent", async () => {
  await withDialbackTunnel(
    async (req) => new Response(`agent saw ${new URL(req.url).pathname}`),
    async (server) => {
      const tree = Gateway({ children: Upstream({ path: "/*", app: server }) });
      const compiled = await compile(tree);
      const res = await compiled.fetch(new Request("http://x/hello"));
      assert.equal(await res.text(), "agent saw /hello");
    },
  );
});
