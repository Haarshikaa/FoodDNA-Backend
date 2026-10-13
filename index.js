
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
          message: "GEMINI_API_KEY is missing from the backend.",
        });
      }

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
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

      return res.json({
        success: true,
        nutrition,
      });
    } catch (error) {
      console.error("Image analysis error:", error.message);

      return res.status(500).json({
        success: false,
        message:
          "Image analysis failed. Check the Gemini API key, model availability, API quota, and backend logs.",
      });
    }
  }
);
