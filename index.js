import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";

dotenv.config();

const app = express();

// Allow JSON + CORS
app.use(cors());
app.use(express.json());

// Serve static files (frontend) from ./public
app.use(express.static("public"));

// ---- OpenAI client ----
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---- Mock wine catalog ----
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

// ---- API: list wines for the UI ----
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

// ---- API: single wine (not strictly needed, but handy) ----
app.get("/api/wines/:id", (req, res) => {
  const wine = getWineById(req.params.id);
  if (!wine) {
    return res.status(404).json({ error: "Wine not found" });
  }
  res.json(wine);
});

// ---- AI helper: catalog-aware + currentWine-aware ----
async function callAiSommelier(currentWine, userQuestion, allWines) {
  // Make a compact catalog so we send fewer tokens each request
  const compactCatalog = allWines.map((w) => ({
    id: w.id,
    name: w.name,
    vintage: w.vintage,
    region: w.region,
    style: w.style,
    grapes: w.grapes,
    tasting_notes: w.tasting_notes,
    price: w.price,
  }));

  const payload = {
    current_wine: currentWine
      ? {
          id: currentWine.id,
          name: currentWine.name,
          vintage: currentWine.vintage,
          region: currentWine.region,
          style: currentWine.style,
          grapes: currentWine.grapes,
          tasting_notes: currentWine.tasting_notes,
          price: currentWine.price,
        }
      : null,
    catalog: compactCatalog,
  };

  const response = await client.responses.create({
    // FASTER MODEL
    model: "gpt-4.1-mini",

    // Keep instructions relatively short, but still structured
    instructions: [
      "You are an expert, friendly sommelier working for this winery.",
      "You get a wine catalog and sometimes a 'current_wine' the guest is viewing.",
      "",
      "Data (JSON):",
      "- catalog: wines with id, name, vintage, region, grapes, style, tasting_notes, price.",
      "- current_wine: the selected wine, or null.",
      "",
      "Behavior:",
      "- If the question is clearly about the current wine (e.g. 'how should I serve this?', 'what pairs with this?', 'tell me about this wine'), focus on current_wine.",
      "- If it’s general (e.g. 'What should I get for steak?', 'What’s your lightest wine?', 'Recommend something under $30'), consider the entire catalog and recommend 1–3 wines by name.",
      "- If they mention a wine by name, match it to the catalog.",
      "- Never invent details that are not in the data.",
      "- Be concise, warm, and non-snobby.",
      "",
      "Response format:",
      "1. One-sentence direct answer.",
      "2. If about one wine: 2–3 sentences describing taste/style.",
      "   If suggesting multiple wines: 1–2 sentences for each wine.",
      "3. 2–4 specific food pairing ideas (dishes).",
      "4. Short serving/occasion tips.",
    ].join("\n"),

    // Limit how long it can go on
    max_output_tokens: 350,

    input: [
      "Here is the wine catalog and current wine in JSON:",
      JSON.stringify(payload, null, 2),
      "",
      "Customer question:",
      userQuestion,
    ].join("\n"),
  });

  return response.output_text;
}


// ---- AI endpoint: wineId is optional (depends on mode) ----
app.post("/sommelier", async (req, res) => {
  try {
    console.log("Received /sommelier request:", req.body);
    const { wineId, userQuestion } = req.body;

    if (!userQuestion) {
      return res.status(400).json({ error: "userQuestion is required" });
    }

    let currentWine = null;

    // In "selected wine" mode, frontend sends wineId
    if (wineId !== undefined && wineId !== null && wineId !== "") {
      currentWine = getWineById(wineId);
      if (!currentWine) {
        console.warn(
          `Wine with id ${wineId} not found; continuing without currentWine.`
        );
      }
    }

    const answer = await callAiSommelier(currentWine, userQuestion, wines);
    res.json({ answer });
  } catch (err) {
    console.error("Error in /sommelier:", err);
    res.status(500).json({ error: "Something went wrong on the server." });
  }
});

// ---- Health check ----
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`AI Sommelier server running on http://localhost:${PORT}`);
});
