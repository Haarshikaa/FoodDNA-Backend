
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Please upload a JPG, PNG, or WEBP image."));
    }
  },
});

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const nutritionData = {
  dosa: { calories: 168, protein: 4, carbs: 29, fat: 4 },
  idli: { calories: 58, protein: 2, carbs: 12, fat: 0.4 },
  rice: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  chapati: { calories: 297, protein: 9, carbs: 50, fat: 7 },
  roti: { calories: 297, protein: 9, carbs: 50, fat: 7 },
  banana: { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  apple: { calories: 52, protein: 0.3, carbs: 13.8, fat: 0.2 },
  egg: { calories: 155, protein: 13, carbs: 1.1, fat: 11 },
  oats: { calories: 389, protein: 16.9, carbs: 66.3, fat: 6.9 },
  chicken: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  potato: { calories: 87, protein: 1.9, carbs: 20.1, fat: 0.1 },
  paneer: { calories: 265, protein: 18.3, carbs: 1.2, fat: 20.8 },
  dal: { calories: 116, protein: 9, carbs: 20, fat: 0.4 },
  salad: { calories: 20, protein: 1, carbs: 4, fat: 0.2 },
};

function estimateNutrition(foodName, grams) {
  const item = nutritionData[String(foodName || "").trim().toLowerCase()];
  if (!item) return null;

  const factor = grams / 100;

  return {
    calories: Math.round(item.calories * factor),
    protein: Math.round(item.protein * factor * 10) / 10,
    carbs: Math.round(item.carbs * factor * 10) / 10,
    fat: Math.round(item.fat * factor * 10) / 10,
    serving_size_g: grams,
    is_estimate: true,
  };
}

function validateFood(body) {
  const food_name = body.food_name;
  const meal_type = body.meal_type;
  const notes = body.notes ?? "";
  const serving_size_g = Number(body.serving_size_g ?? 100);

  if (
    typeof food_name !== "string" ||
    !food_name.trim() ||
    food_name.trim().length > 150
  ) {
    return { error: "Enter a valid food name (maximum 150 characters)." };
  }

  if (!["Breakfast", "Lunch", "Dinner", "Snack"].includes(meal_type)) {
    return { error: "Select a valid meal type." };
  }

  if (typeof notes !== "string" || notes.length > 2000) {
    return { error: "Notes must be under 2000 characters." };
  }

  if (
    !Number.isFinite(serving_size_g) ||
    serving_size_g < 1 ||
    serving_size_g > 5000
  ) {
    return { error: "Serving size must be between 1 and 5000 grams." };
  }

  return {
    food_name: food_name.trim(),
    meal_type,
    notes: notes.trim(),
    serving_size_g,
  };
}

// Validate and scale nutrition values from a photo analysis.
function validateNutritionEstimate(estimate, servingSize) {
  if (
    !estimate ||
    typeof estimate !== "object" ||
    Array.isArray(estimate)
  ) {
    return { error: "Invalid nutrition estimate." };
  }

  const originalServing = Number(estimate.serving_size_g);

  if (
    !Number.isFinite(originalServing) ||
    originalServing < 1 ||
    originalServing > 5000
  ) {
    return { error: "Invalid estimated serving size." };
  }

  const values = {};

  for (const field of ["calories", "protein", "carbs", "fat"]) {
    const value = estimate[field];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0 ||
      Number(value) > 100000
    ) {
      return { error: `Invalid nutrition value: ${field}.` };
    }

    values[field] = Number(value);
  }

  const factor = servingSize / originalServing;

  return {
    nutrition: {
      calories: Math.round(values.calories * factor),
      protein: Math.round(values.protein * factor * 10) / 10,
      carbs: Math.round(values.carbs * factor * 10) / 10,
      fat: Math.round(values.fat * factor * 10) / 10,
      serving_size_g: servingSize,
      is_estimate: true,
    },
  };
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS food_entries (
      id SERIAL PRIMARY KEY,
      food_name VARCHAR(150) NOT NULL,
      meal_type VARCHAR(30) NOT NULL,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE food_entries
      ADD COLUMN IF NOT EXISTS serving_size_g NUMERIC DEFAULT 100,
      ADD COLUMN IF NOT EXISTS calories NUMERIC,
      ADD COLUMN IF NOT EXISTS protein NUMERIC,
      ADD COLUMN IF NOT EXISTS carbs NUMERIC,
      ADD COLUMN IF NOT EXISTS fat NUMERIC
  `);

  console.log("FoodDNA database table is ready.");
}

app.get("/", (req, res) => {
  res.send("FoodDNA backend is running!");
});

app.get("/api/db-test", async (req, res) => {
  try {
    await pool.query("SELECT NOW()");
    res.json({
      success: true,
      message: "Neon connected successfully!",
    });
  } catch (error) {
    console.error("Database test error:", error.message);
    res.status(500).json({
      success: false,
      message: "Database connection failed.",
    });
  }
});

// Analyze a food photo using Gemini. This route does not save the food.
app.post(
  "/api/analyze-food-image",
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please upload a food image.",
        });
      }

      if (!genAI) {
        return res.status(500).json({
          success: false,
          message: "GEMINI_API_KEY is missing from backend/.env.",
        });
      }

      const model = genAI.getGenerativeModel({
        model: "gemini-3.7-flash",
      });

      const result = await model.generateContent([
        `Analyze this food photo for a food journal.
Return ONLY valid JSON, without markdown, in this format:
{
  "foodName": "name of the food",
  "servingSizeG": 250,
  "calories": 350,
  "protein": 12,
  "carbs": 45,
  "fat": 10,
  "explanation": "Brief explanation of the estimate"
}
Estimate the visible portion in grams and total nutrition for that portion.
Use non-negative numbers. Values are approximate, not exact measurements.
Mention uncertainty from portion size, oil, sauces, and hidden ingredients.
If the food cannot be identified, explain that in foodName and explanation.`,
        {
          inlineData: {
            mimeType: req.file.mimetype,
            data: req.file.buffer.toString("base64"),
          },
        },
      ]);

      const text = result.response
        .text()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const nutrition = JSON.parse(text);

      for (const field of [
        "servingSizeG",
        "calories",
        "protein",
        "carbs",
        "fat",
      ]) {
        if (
          !Number.isFinite(Number(nutrition[field])) ||
          Number(nutrition[field]) < 0
        ) {
          throw new Error(`Invalid nutrition value: ${field}`);
        }

        nutrition[field] = Number(nutrition[field]);
      }

      if (
        typeof nutrition.foodName !== "string" ||
        !nutrition.foodName.trim() ||
        nutrition.servingSizeG < 1 ||
        nutrition.servingSizeG > 5000
      ) {
        throw new Error("Invalid food name or serving size returned.");
      }

      nutrition.isEstimate = true;

      res.json({
        success: true,
        nutrition,
      });
    } catch (error) {
      console.error("Image analysis error:", error.message);

      res.status(500).json({
        success: false,
        message:
          "Image analysis failed. Check the Gemini API key, model availability, API quota, and backend terminal.",
      });
    }
  }
);

// Get saved foods
app.get("/api/foods", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM food_entries ORDER BY created_at DESC"
    );

    res.json({
      success: true,
      foods: result.rows,
    });
  } catch (error) {
    console.error("Get foods error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not retrieve foods.",
    });
  }
});

// Add a food. Uses validated photo nutrition when supplied;
// otherwise calculates nutrition using the existing local food list.
app.post("/api/foods", async (req, res) => {
  const food = validateFood(req.body);

  if (food.error) {
    return res.status(400).json({
      success: false,
      message: food.error,
    });
  }

  let nutrition;

  if (req.body.nutrition_estimate !== undefined) {
    const validated = validateNutritionEstimate(
      req.body.nutrition_estimate,
      food.serving_size_g
    );

    if (validated.error) {
      return res.status(400).json({
        success: false,
        message: validated.error,
      });
    }

    nutrition = validated.nutrition;
  } else {
    nutrition = estimateNutrition(
      food.food_name,
      food.serving_size_g
    );
  }

  try {
    const result = await pool.query(
      `INSERT INTO food_entries
        (food_name, meal_type, notes, serving_size_g,
         calories, protein, carbs, fat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        food.food_name,
        food.meal_type,
        food.notes,
        food.serving_size_g,
        nutrition?.calories ?? null,
        nutrition?.protein ?? null,
        nutrition?.carbs ?? null,
        nutrition?.fat ?? null,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Food saved successfully!",
      food: result.rows[0],
      nutrition,
    });
  } catch (error) {
    console.error("Save food error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not save food.",
    });
  }
});

// Edit a food
app.put("/api/foods/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid food ID.",
    });
  }

  const food = validateFood(req.body);

  if (food.error) {
    return res.status(400).json({
      success: false,
      message: food.error,
    });
  }

  try {
    const nutrition = estimateNutrition(
      food.food_name,
      food.serving_size_g
    );

    const result = await pool.query(
      `UPDATE food_entries
       SET food_name = $1,
           meal_type = $2,
           notes = $3,
           serving_size_g = $4,
           calories = $5,
           protein = $6,
           carbs = $7,
           fat = $8
       WHERE id = $9
       RETURNING *`,
      [
        food.food_name,
        food.meal_type,
        food.notes,
        food.serving_size_g,
        nutrition?.calories ?? null,
        nutrition?.protein ?? null,
        nutrition?.carbs ?? null,
        nutrition?.fat ?? null,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Food record not found.",
      });
    }

    res.json({
      success: true,
      message: "Food updated!",
      food: result.rows[0],
    });
  } catch (error) {
    console.error("Update food error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not update food.",
    });
  }
});

// Delete a food
app.delete("/api/foods/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid food ID.",
    });
  }

  try {
    const result = await pool.query(
      "DELETE FROM food_entries WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Food record not found.",
      });
    }

    res.json({
      success: true,
      message: "Food deleted successfully!",
    });
  } catch (error) {
    console.error("Delete food error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not delete food.",
    });
  }
});

// Free rule-based insights; no OpenAI API call
app.post("/api/insights", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT food_name, meal_type, serving_size_g,
              calories, protein, carbs, fat
       FROM food_entries
       ORDER BY created_at DESC
       LIMIT 50`
    );

    const foods = result.rows;

    if (foods.length === 0) {
      return res.json({
        success: true,
        insights:
          "No meals recorded yet. Add your meals to receive nutrition insights.",
      });
    }

    const total = (field) =>
      foods.reduce(
        (sum, food) => sum + Number(food[field] || 0),
        0
      );

    const totalCalories = total("calories");
    const totalProtein = total("protein");
    const totalCarbs = total("carbs");
    const totalFat = total("fat");

    const knownFoods = foods.filter(
      (food) => food.calories != null
    );
    const unknownCount = foods.length - knownFoods.length;

    const proteinSources = knownFoods
      .filter((food) => Number(food.protein || 0) >= 5)
      .slice(0, 3)
      .map((food) => food.food_name);

    const mealTypes = [
      ...new Set(
        foods.map((food) => food.meal_type).filter(Boolean)
      ),
    ];

    const insights = [
      `Your ${foods.length} most recently recorded food entries contain approximately ${Math.round(totalCalories)} kcal, ${totalProtein.toFixed(1)} g protein, ${totalCarbs.toFixed(1)} g carbohydrates, and ${totalFat.toFixed(1)} g fat in total.`,
    ];

    if (proteinSources.length > 0) {
      insights.push(
        `Some protein-containing foods in your records include ${[
          ...new Set(proteinSources),
        ].join(", ")}.`
      );
    } else {
      insights.push(
        "Consider adding protein-containing foods such as dal, beans, eggs, paneer, or tofu if they suit your dietary needs."
      );
    }

    if (mealTypes.length < 3) {
      insights.push(
        "Your records currently cover fewer than three meal types. Keep logging meals consistently for a more complete food journal."
      );
    } else {
      insights.push(
        "You have logged several meal types. Continue recording meals to help identify eating patterns."
      );
    }

    if (unknownCount > 0) {
      insights.push(
        `Nutrition estimates are unavailable for ${unknownCount} record(s) because the local nutrition list supports selected foods only.`
      );
    }

    insights.push(
      "General tip: aim for variety with vegetables or fruit, protein sources, and suitable whole grains. These estimates may not represent your complete daily intake and are not medical advice."
    );

    res.json({
      success: true,
      insights: insights.join("\n\n"),
    });
  } catch (error) {
    console.error("Local insights error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not generate nutrition insights.",
    });
  }
});

// Handle image upload errors
app.use((error, req, res, next) => {
  if (
    error instanceof multer.MulterError ||
    error.message?.startsWith("Please upload a JPG")
  ) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  console.error("Request error:", error.message);

  res.status(500).json({
    success: false,
    message: "Unexpected server error.",
  });
});

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`FoodDNA backend running on port ${PORT}`);
      console.log(
        "Food CRUD, nutrition estimates, image analysis, and free insights routes registered."
      );
    });
  } catch (error) {
    console.error("Backend startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
