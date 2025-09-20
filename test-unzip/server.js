// server.js
// API NICO-RAG – Chat + OBO Graph + Azure OpenAI

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { ConfidentialClientApplication } = require("@azure/msal-node");

const app = express();
app.use(express.json());

// ------------------ Config / Env ------------------
const PORT = process.env.PORT || 8080;

// CORS : liste séparée par des virgules
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Azure AD (OBO)
const TENANT_ID = process.env.TENANT_ID;
const API_CLIENT_ID = process.env.API_CLIENT_ID;
const API_CLIENT_SECRET = process.env.API_CLIENT_SECRET;

// Azure OpenAI
const AOAI_ENDPOINT_RAW = process.env.AOAI_ENDPOINT || "";  // ex: https://aoai-xxx.openai.azure.com
const AOAI_ENDPOINT = AOAI_ENDPOINT_RAW.replace(/\/+$/,"");  // retire / final
const AOAI_KEY = process.env.AOAI_KEY;
const AOAI_DEPLOYMENT = process.env.AOAI_DEPLOYMENT || "gpt-chat"; // ton nom de déploiement
const AOAI_API_VERSION = "2024-06-01";

// ------------------ MSAL (OBO) ------------------
const USER_TOKEN_HEADER = "x-ms-token-aad-access-token";
const cca = new ConfidentialClientApplication({
  auth: {
    clientId: API_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    clientSecret: API_CLIENT_SECRET
  }
});

async function getGraphTokenFromUserToken(userToken) {
  const obo = await cca.acquireTokenOnBehalfOf({
    oboAssertion: userToken,
    scopes: ["https://graph.microsoft.com/.default"],
    skipCache: true
  });
  if (!obo || !obo.accessToken) throw new Error("OBO failed");
  return obo.accessToken;
}

// ------------------ Middlewares ------------------
if (ALLOWED_ORIGINS.length) {
  const corsOptions = {
    origin(origin, cb) {
      // Autorise Postman/curl (origin null)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error("CORS blocked: " + origin), false);
    },
    credentials: false
  };
  app.use(cors(corsOptions));
} else {
  app.use(cors()); // permissif si non configuré
}

// ------------------ Routes base ------------------
app.get("/ping", (_, res) => res.status(200).send("pong"));

app.get("/", (_, res) => res.status(200).send("API OK (Easy Auth)"));

// DIAG (vérifie la présence des settings AOAI)
app.get("/diag", (_, res) => {
  res.json({
    hasEndpoint: !!AOAI_ENDPOINT,
    hasKey: !!AOAI_KEY,
    deployment: AOAI_DEPLOYMENT || null,
    node: process.version
  });
});

// Proxy Graph /me (OBO)
app.get("/graph/me", async (req, res) => {
  try {
    const userToken = req.headers[USER_TOKEN_HEADER];
    if (!userToken) {
      return res.status(401).json({ error: "Missing user token (x-ms-token-aad-access-token)" });
    }
    const t = await getGraphTokenFromUserToken(userToken);
    const r = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${t}` }
    });
    const d = await r.json();
    res.status(r.status).json(d);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ------------------ Chat Azure OpenAI ------------------
/**
 * POST /chat
 * body: {
 *   messages: [{role:'system'|'user'|'assistant', content:'...'}, ...],
 *   includeProfile?: boolean,      // si true, injecte le profil Graph dans un message système
 *   temperature?: number,
 *   max_tokens?: number
 * }
 */
app.post("/chat", async (req, res) => {
  try {
    if (!AOAI_ENDPOINT || !AOAI_KEY || !AOAI_DEPLOYMENT) {
      return res.status(500).json({ error: "Azure OpenAI settings missing (AOAI_ENDPOINT/AOAI_KEY/AOAI_DEPLOYMENT)" });
    }

    let { messages, includeProfile, temperature, max_tokens } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }

    // Optionnel : enrichir avec le profil Graph de l'utilisateur
    if (includeProfile) {
      const userToken = req.headers[USER_TOKEN_HEADER];
      if (!userToken) {
        return res.status(401).json({ error: "Missing user token for includeProfile" });
      }
      try {
        const graphToken = await getGraphTokenFromUserToken(userToken);
        const meResp = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${graphToken}` }
        });
        const me = await meResp.json();

        const sys = {
          role: "system",
          content:
            `Tu es l'assistant NICO-RAG. Tu aides l'utilisateur en tenant compte de son profil Microsoft 365 ` +
            `(displayName=${me.displayName || "?"}, mail=${me.mail || me.userPrincipalName || "?"}). ` +
            `Réponds de façon concise et utile.`
        };
        messages = [sys, ...messages];
      } catch (e) {
        // Si Graph échoue, on continue sans profil
        console.warn("includeProfile failed:", e.message || e);
      }
    }

    // Appel Azure OpenAI (non-stream)
    const url = `${AOAI_ENDPOINT}/openai/deployments/${encodeURIComponent(AOAI_DEPLOYMENT)}/chat/completions?api-version=${AOAI_API_VERSION}`;
    const payload = {
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.3,
      max_tokens: typeof max_tokens === "number" ? max_tokens : 800
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": AOAI_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: "AOAI error", details: data });
    }

    // Normalise un peu la réponse pour le front
    const choice = data.choices && data.choices[0];
    const content = choice?.message?.content || "";
    res.json({
      model: data.model || AOAI_DEPLOYMENT,
      usage: data.usage || null,
      message: { role: "assistant", content }
    });
  } catch (e) {
    console.error("CHAT error", e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ------------------ Start ------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log("API listening on " + PORT);
});
