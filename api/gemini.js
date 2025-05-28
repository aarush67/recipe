import { RateLimiter } from 'limiter';
import NodeCache from 'node-cache';

// Initialize cache and rate limiter
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour
const limiter = new RateLimiter({ tokensPerInterval: 10, interval: 'minute' });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.error('Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    console.error('Invalid prompt:', prompt);
    return res.status(400).json({ error: 'Valid prompt is required' });
  }

  if (prompt.length > 1000) {
    console.error('Prompt too long:', prompt.length);
    return res.status(400).json({ error: 'Prompt exceeds 1000 characters' });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY environment variable not set');
    return res.status(500).json({ error: 'Server configuration error: API key missing' });
  }

  // Rate limiting
  const remainingRequests = await limiter.removeTokens(1);
  if (remainingRequests < 0) {
    console.error('Rate limit exceeded');
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }

  // Check cache
  const cacheKey = `recipe_${prompt}`;
  const cachedResponse = cache.get(cacheKey);
  if (cachedResponse) {
    console.log('Serving from cache:', cacheKey);
    return res.status(200).json(cachedResponse);
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API request failed:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      console.error('Invalid Gemini API response:', JSON.stringify(data));
      throw new Error('Invalid response format from Gemini API');
    }

    let recipeText = data.candidates[0].content.parts[0].text;
    recipeText = recipeText.replace(/^```json\n|\n```$/g, '').trim();

    let recipe;
    try {
      recipe = JSON.parse(recipeText);
      if (Array.isArray(recipe.ingredients)) {
        recipe.ingredients = recipe.ingredients.map((ingredient) => {
          if (typeof ingredient === 'string') return ingredient;
          if (ingredient && typeof ingredient === 'object' && 'item' in ingredient) {
            return ingredient.amount ? `${ingredient.item} (${ingredient.amount})` : ingredient.item;
          }
          return 'Unknown ingredient';
        });
      }
      if (!recipe.name || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.instructions)) {
        throw new Error('Incomplete recipe data');
      }
    } catch (err) {
      console.error('Invalid JSON from Gemini API:', recipeText);
      throw new Error('Invalid JSON format: ' + err.message);
    }

    const responseData = { recipe: JSON.stringify(recipe) };
    cache.set(cacheKey, responseData);
    res.status(200).json(responseData);
  } catch (err) {
    console.error('Gemini API Error:', err.message, err.stack);
    res.status(500).json({ error: `Failed to generate recipe: ${err.message}` });
  }
}
