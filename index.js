import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ----------------------
// BRAND CONFIG (EDIT THIS)
// ----------------------
const brandConfig = {
  wineryName: "Crown Ridge Cellars",
  shortTagline: "Elegant, approachable wines for real life.",
  tone: "warm, confident, friendly, non-snobby",
  voiceGuidelines: [
    "Sound like a great tasting-room host: welcoming and helpful.",
    "Avoid heavy jargon; if you use a wine term, explain it simply.",
    "Keep responses concise and scannable.",
    "Never invent details not in the provided data.",
  ],
  // Light business goals for the assistant (keep subtle)
  goals: [
    "Help the customer choose quickly and confidently.",
    "Recommend 1–3 wines when the question is general.",
    "Gently upsell when it makes sense (e.g., special occasion, gift, premium pairing).",
  ],
};

// ---- OpenAI client ----
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ----------------------
// MOCK WINE CATALOG
// ----------------------
const wines = [
  {
    id: 1,
    name: "Estate Pinot Noir",
    vintage: 2021,
    region: "Willamette Valley",
    country: "USA",
    grapes: ["Pinot Noir"],
    style: "Light-bodied red",
    tasting_notes: "Cherry, raspberry, subtle oak, silky tannins.",
    abv: 13.5,
    price: 38,
    story:
      "From hillside vineyards with cool nights, focused on elegance and freshness.",
  },
  {
    id: 2,
    name: "Reserve Chardonnay",
    vintage: 2020,
    region: "Russian River Valley",
    country: "USA",
    grapes: ["Chardonnay"],
    style: "Full-bodied white",
    tasting_notes: "Ripe peach, vanilla, toasted brioche, creamy texture.",
    abv: 14.0,
    price: 42,
    story:
      "Barrel-fermented Chardonnay from old vines, marrying richness with acidity.",
  },
  {
    id: 3,
    name: "Rosé of Grenache",
    vintage: 2022,
    region: "Central Coast",
    country: "USA",
    grapes: ["Grenache"],
    style: "Dry rosé",
    tasting_notes: "Strawberry, watermelon, citrus zest, refreshing finish.",
    abv: 12.5,
    price: 24,
    story:
      "Whole-cluster pressed and fermented cold for bright, vibrant fruit.",
  },
];

function getWineById(id) {
  const idNum = Number(id);
  return wines.find((w) => Number(w.id) === idNum) || null;
}

function compactWine(w) {
  if (!w) return null;
  return {
    id: w.id,
    name: w.name,
    vintage: w.vintage,
    region: w.region,
    country: w.country,
    grapes: w.grapes,
    style: w.style,
    tasting_notes: w.tasting_notes,
    abv: w.abv,
    price: w.price,
    story: w.story,
  };
}

function compactCatalog(allWines) {
  // Keep this relatively small for speed
  return allWines.map((w) => ({
    id: w.id,
    name: w.name,
    vintage: w.vintage,
    region: w.region,
    style: w.style,
    grapes: w.grapes,
    tasting_notes: w.tasting_notes,
    abv: w.abv,
    price: w.price,
  }));
}

// ----------------------
// API: Wines for UI
// ----------------------
app.get("/api/wines", (req, res) => {
  res.json(
    wines.map((w) => ({
      id: w.id,
      name: w.name,
      vintage: w.vintage,
      region: w.region,
      style: w.style,
      price: w.price,
      grapes: w.grapes,
      tasting_notes: w.tasting_notes,
    }))
  );
});

// Optional, handy for future
app.get("/api/wines/:id", (req, res) => {
  const wine = getWineById(req.params.id);
  if (!wine) return res.status(404).json({ error: "Wine not found" });
  res.json(wine);
});

// ----------------------
// API: Smart prompts for UI
// ----------------------
app.get("/api/prompts", (req, res) => {
  const mode = (req.query.mode || "selected").toLowerCase();

  const selectedModePrompts = [
    "What food pairs best with this wine?",
    "Explain this wine like I’m new to wine.",
    "How should I serve this (temp, glass, decant)?",
    "Is this better for a dinner party or a cozy night in?",
    "What’s one similar wine on your list I should try next?",
  ];

  const allModePrompts = [
    "I’m making steak tonight — which wine should I choose?",
    "Recommend a wine under $30 for a gift.",
    "I like fruity, not too sweet — what should I buy?",
    "Which wine is the best crowd-pleaser for a dinner party?",
    "I usually drink white — suggest an easy red to start with.",
  ];

  res.json({
    mode,
    prompts: mode === "all" ? allModePrompts : selectedModePrompts,
  });
});

// ----------------------
// AI: Prompt + Response
// ----------------------
function buildSommelierInstructions() {
  return [
    `You are the AI Sommelier for ${brandConfig.wineryName}.`,
    `Brand tagline: ${brandConfig.shortTagline}`,
    `Voice/tone: ${brandConfig.tone}`,
    "",
    "VOICE GUIDELINES:",
    ...brandConfig.voiceGuidelines.map((v) => `- ${v}`),
    "",
    "GOALS:",
    ...brandConfig.goals.map((g) => `- ${g}`),
    "",
    "DATA RULES:",
    "- You will receive JSON with two keys: catalog (array) and current_wine (object or null).",
    "- Use ONLY this data. If something is missing, say you don’t have that info.",
    "- Never invent critic scores, exact oak %, soil, appellation rules, production size, etc. unless provided.",
    "",
    "MODE BEHAVIOR:",
    "- If the question is about 'this wine' and current_wine is present: focus on current_wine.",
    "- If the question is general (food/occasion/budget/style): consider the full catalog and recommend 1–3 wines by name.",
    "- If you recommend multiple wines, keep each recommendation short and clearly labeled.",
    "",
    "OUTPUT FORMAT (always use this structure):",
    "1) Direct answer (one sentence).",
    "2) Recommendation(s):",
    "   - If single wine: 2–4 sentences describing taste/style + why it fits the question.",
    "   - If 2–3 wines: bullet list with 1–2 sentences each.",
    "3) Food pairing ideas (2–4 specific dishes) if relevant.",
    "4) Serving tips (temp, glass, decant if useful). Keep it brief.",
    "5) Optional gentle upsell: suggest one upgrade or add-on choice when appropriate (e.g., Reserve for a special occasion).",
  ].join("\n");
}

async function callAiSommelier(currentWine, userQuestion, allWines) {
  const payload = {
    current_wine: compactWine(currentWine),
    catalog: compactCatalog(allWines),
    brand: brandConfig, // safe to include; helps the model stay on brand
  };

  const response = await client.responses.create({
    // Faster model for better UX
    model: "gpt-4.1-mini",
    instructions: buildSommelierInstructions(),
    // Keep responses tight and fast
    max_output_tokens: 380,
    input: [
      "Here is the brand + wine data in JSON:",
      JSON.stringify(payload, null, 2),
      "",
      "Customer question:",
      userQuestion,
    ].join("\n"),
  });

  return response.output_text;
}

// ----------------------
// POST /sommelier (wineId optional)
// ----------------------
app.post("/sommelier", async (req, res) => {
  try {
    const { wineId, userQuestion } = req.body;
    if (!userQuestion) {
      return res.status(400).json({ error: "userQuestion is required" });
    }

    let currentWine = null;
    if (wineId !== undefined && wineId !== null && wineId !== "") {
      currentWine = getWineById(wineId);
      if (!currentWine) {
        console.warn(`Wine with id ${wineId} not found; continuing without it.`);
      }
    }

    const answer = await callAiSommelier(currentWine, userQuestion, wines);
    res.json({ answer });
  } catch (err) {
    console.error("Error in /sommelier:", err);
    res.status(500).json({ error: "Something went wrong on the server." });
  }
});

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`AI Sommelier server running on http://localhost:${PORT}`);
});
