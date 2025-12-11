import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves public/index.html etc.

// ---- OpenAI client ----
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---- Mock wine data ----
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

app.get("/api/wines/:id", (req, res) => {
  const wine = getWineById(req.params.id);
  if (!wine) {
    return res.status(404).json({ error: "Wine not found" });
  }
  res.json(wine);
});

// ---- AI helper: now aware of currentWine + whole catalog ----
async function callAiSommelier(currentWine, userQuestion, allWines) {
  const payload = {
    current_wine: currentWine, // may be null
    catalog: allWines,
  };

  const response = await client.responses.create({
    model: "gpt-4.1", // or "gpt-4.1-mini" if you want cheaper
    instructions: [
      "You are an expert, friendly sommelier working for this winery.",
      "You are given the full wine catalog and sometimes a 'current_wine' the guest is viewing.",
      "",
      "Data you receive (JSON):",
      "- catalog: array of wines with id, name, vintage, region, grapes, style, tasting_notes, price, story, etc.",
      "- current_wine: the wine the user has selected, or null if none.",
      "",
      "Behavior rules:",
      "- If the user’s question is clearly about the current wine (e.g., 'how should I serve this?', 'what pairs with this?', 'tell me about this wine'), focus on current_wine.",
      "- If they ask generally (e.g., 'What should I get for steak?', 'What’s your lightest wine?', 'Recommend something for summer'), consider the entire catalog and recommend 1–3 wines by name.",
      "- If they mention a specific wine by name, match it against the catalog and talk about that wine.",
      "- If something is not in the data, say you don't know instead of inventing details.",
      "- Be concise, warm, and non-snobby; assume the user may be a beginner.",
      "",
      "Response format (always in this structure):",
      "1. One-sentence summary answering the user directly.",
      "2. If answering about one wine: short tasting/style profile (2–4 sentences).",
      "   If recommending multiple wines: briefly describe each recommended wine (1–2 sentences each).",
      "3. Specific food pairing ideas (3–5 concrete dishes) if relevant.",
      "4. Serving and occasion tips (temperature, glass, decanting, when to drink it).",
      "5. Optional: a gentle upsell or suggestion using other wines from the catalog when appropriate."
    ].join("\n"),
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

// ---- AI endpoint: wineId is now optional ----
app.post("/sommelier", async (req, res) => {
  try {
    console.log("Received /sommelier request:", req.body);
    const { wineId, userQuestion } = req.body;

    if (!userQuestion) {
      return res.status(400).json({ error: "userQuestion is required" });
    }

    let currentWine = null;

    // When in "selected wine" mode, frontend sends wineId
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

// Simple health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`AI Sommelier server running on http://localhost:${PORT}`);
});
