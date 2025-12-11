import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";

dotenv.config();

const app = express();

// Allow cross-origin requests (handy for dev / future integration)
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Serve static files from ./public (for your mock website)
app.use(express.static("public"));

// ---- OpenAI client ----
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---- Mock wine data (this replaces a real DB/API for now) ----
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

// ---- Helper: look up wine by ID ----
function getWineById(id) {
  const idNum = Number(id);
  return wines.find((w) => Number(w.id) === idNum) || null;
}

// ---- API: list wines (for the frontend UI) ----
app.get("/api/wines", (req, res) => {
  // You can strip some fields if you want this to be lighter
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

// ---- API: single wine details ----
app.get("/api/wines/:id", (req, res) => {
  const wine = getWineById(req.params.id);
  if (!wine) {
    return res.status(404).json({ error: "Wine not found" });
  }
  res.json(wine);
});

// ---- AI helper ----
async function callAiSommelier(wineData, userQuestion) {
  const response = await client.responses.create({
    model: "gpt-4.1", // or "gpt-4.1-mini" if you want cheaper
    instructions: [
      "You are an expert, friendly sommelier working for this winery.",
      "Use the structured wine data provided (name, vintage, region, grapes, style, tasting_notes, story, etc.) to answer.",
      "",
      "Rules:",
      "- Base everything on the wine data provided. If something is not in the data, say you don't know.",
      "- Be concise, warm, and non-snobby.",
      "- Assume the user might be a beginner; avoid heavy jargon or explain it briefly.",
      "- If the user asks a general question (not about food pairing), still answer using this wine as context when relevant.",
      "- Never invent technical details (soil type, barrel regimen, scores) unless they appear in the data.",
      "",
      "Response format (always in this structure):",
      "1. One-sentence summary answering the user directly.",
      "2. Short tasting and style profile of the wine (2–4 sentences).",
      "3. Specific food pairing ideas (3–5 concrete dishes).",
      "4. Serving and occasion tips (temperature, glass, decanting, when to drink it).",
      "5. Optional: a gentle upsell or suggestion for when they'd enjoy this wine most."
    ].join("\n"),
    input: [
      "Here is the wine data in JSON:",
      JSON.stringify(wineData, null, 2),
      "",
      "Customer question:",
      userQuestion,
    ].join("\n"),
  });

  return response.output_text;
}

// ---- Main AI endpoint ----
app.post("/sommelier", async (req, res) => {
  try {
    console.log("Received /sommelier request:", req.body);

    const { wineId, userQuestion } = req.body;

    if (!wineId || !userQuestion) {
      return res
        .status(400)
        .json({ error: "wineId and userQuestion are required" });
    }

    const wine = getWineById(wineId);
    if (!wine) {
      return res.status(404).json({ error: "Wine not found" });
    }

    const answer = await callAiSommelier(wine, userQuestion);
    res.json({ answer });
  } catch (err) {
    console.error("Error in /sommelier:", err);
    res.status(500).json({ error: "Something went wrong on the server." });
  }
});

// ---- Health / root ----
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`AI Sommelier server running on http://localhost:${PORT}`);
});
