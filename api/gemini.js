export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.error('Invalid method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    console.error('Missing prompt in request body');
    return res.status(400).json({ error: 'Prompt is required' });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY environment variable not set');
    return res.status(500).json({ error: 'Server configuration error: API key missing' });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
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
    });

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
    // Strip markdown code block and language identifier
    recipeText = recipeText.replace(/^```json\n|\n```$/g, '').trim();
    // Validate JSON
    try {
      JSON.parse(recipeText);
    } catch (err) {
      console.error('Invalid JSON from Gemini API:', recipeText);
      throw new Error('Invalid JSON format: ' + err.message);
    }

    res.status(200).json({ recipe: recipeText });
  } catch (err) {
    console.error('Gemini API Error:', err.message, err.stack);
    res.status(500).json({ error: `Failed to generate recipe: ${err.message}` });
  }
}
