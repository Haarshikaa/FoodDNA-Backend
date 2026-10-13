# FoodDNA Backend

Backend REST API for **FoodDNA – AI-Powered Food and Nutrition Analysis System**.

## Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** PostgreSQL (Neon Serverless)
- **AI Vision:** Google Gemini API (`@google/generative-ai`)
- **File Upload:** Multer

## Features
- **Food Image Analysis:** Multi-modal analysis via Gemini API (`POST /api/analyze-food-image`).
- **Nutrient Estimation:** Calculates calories, protein, carbs, and fat per serving size.
- **Meal Management:** Full CRUD operations for daily food entries.
- **Rule-based Insights:** Local nutrition analysis and eating pattern suggestions.

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <your-backend-repo-url>
   cd fooddna-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Fill in your PostgreSQL `DATABASE_URL` and `GEMINI_API_KEY`.

4. **Run the server:**
   ```bash
   npm start
   # or
   node index.js
   ```
   The server starts at `http://localhost:5000`.

## API Endpoints
- `GET /` - Health check
- `GET /api/db-test` - Test database connection
- `GET /api/foods` - Fetch all saved food entries
- `POST /api/foods` - Add a new food entry
- `PUT /api/foods/:id` - Update a food entry
- `DELETE /api/foods/:id` - Delete a food entry
- `POST /api/analyze-food-image` - Upload and analyze food photo with Gemini
- `POST /api/insights` - Generate nutrition insights
