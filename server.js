const express = require("express");
const fetch = require("node-fetch");
const { ConfidentialClientApplication } = require("@azure/msal-node");

const app = express();
app.use(express.json());

// Santé
app.get("/ping", (_, res) => res.status(200).send("pong"));

// Jeton utilisateur fourni par Easy Auth (Token Store activé)
const USER_TOKEN_HEADER = "x-ms-token-aad-access-token";

// MSAL (OBO)
const cca = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.API_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.API_CLIENT_SECRET
  }
});

// Helper OBO -> Graph token
async function getGraphTokenFromUserToken(userToken) {
  const obo = await cca.acquireTokenOnBehalfOf({
    oboAssertion: userToken,
    scopes: ["https://graph.microsoft.com/.default"],
    skipCache: true
  });
  if (!obo || !obo.accessToken) throw new Error("OBO failed");
  return obo.accessToken;
}

// Accueil
app.get("/", (_, res) => res.status(200).send("API OK (Easy Auth)"));

// Graph /me
app.get("/graph/me", async (req, res) => {
  try {
    const userToken = req.headers[USER_TOKEN_HEADER];
    if (!userToken) return res.status(401).json({ error: "Missing user token" });
    const t = await getGraphTokenFromUserToken(userToken);
    const r = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${t}` } });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
});

// DIAG: vérifier que l'API voit bien les settings AOAI
app.get("/diag", (_, res) => {
  res.json({
    hasEndpoint: !!process.env.AOAI_ENDPOINT,
    hasKey: !!process.env.AOAI_KEY,
    deployment: process.env.AOAI_DEPLOYMENT || null,
    node: process.version
  });
});

// Démarrage
const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => console.log("API listening on " + port));
