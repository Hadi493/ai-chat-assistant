require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fetch = require('node-fetch');

// Adicione este log logo após o require('dotenv').config();
console.log('Checking environment:', {
    envLoaded: process.env.GEMINI_API_KEY ? 'Yes' : 'No',
    keyLength: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0,
    keyStart: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 4) : 'none'
});

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Adicione este log para debug
console.log('Gemini API Key:', process.env.GEMINI_API_KEY ? 'Presente' : 'Ausente');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Add this helper function near the top
function formatAIResponse(text) {
    // Remove multiple blank lines
    text = text.replace(/\n{3,}/g, '\n\n');
    
    // Ensure code blocks are properly formatted
    text = text.replace(/```(\w+)?\s*([\s\S]*?)```/g, (match, language, code) => {
        // Remove empty lines at start and end of code block
        code = code.trim();
        // Add language tag if missing
        language = language || 'plaintext';
        return `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    });
    
    // Add proper line breaks between sections
    text = text.replace(/([^.!?])\n([A-Z])/g, '$1\n\n$2');
    
    // Clean up bullet points
    text = text.replace(/^\s*[-*]\s*/gm, '• ');
    
    return text.trim();
}

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Gemini API key is not configured'
            });
        }
        
        // Generate content using Gemini with retry logic
        let retries = 3;
        let result;
        let text;
        
        while (retries > 0) {
            try {
                // Initialize the model
                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                
                // Generate content
                result = await model.generateContent(message);
                const response = await result.response;
                text = response.text();
                
                break; // If successful, exit the loop
            } catch (error) {
                console.error('Gemini Error:', error);
                
                if (error.message?.includes('quota')) {
                    console.log(`Rate limit exceeded, retries left: ${retries-1}`);
                    if (retries > 1) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        retries--;
                        continue;
                    }
                    return res.status(429).json({
                        success: false,
                        error: 'Rate limit exceeded. Please try again in a moment.'
                    });
                }
                
                // Handle specific Gemini errors
                if (error.message?.includes('invalid')) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid request to AI service'
                    });
                } else if (error.message?.includes('authentication')) {
                    return res.status(401).json({
                        success: false,
                        error: 'Invalid API key'
                    });
                }
                
                throw error;
            }
        }
        
        if (!result || !text) {
            return res.status(500).json({
                success: false,
                error: 'Failed to get response from AI service'
            });
        }
        
        // Format the response before sending
        const formattedText = formatAIResponse(text);
        
        res.json({ 
            success: true,
            reply: formattedText
        });
    } catch (error) {
        console.error('Server Error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'An unexpected error occurred'
        });
    }
});

// Image generation endpoint using ModelsLab API
app.post('/api/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required'
            });
        }

        try {
            const response = await fetch('https://modelslab.com/api/v6/realtime/text2img', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.MODELSLAB_API_KEY}`
                },
                body: JSON.stringify({
                    prompt: prompt,
                    model_name: "sdxl",  // Using
                    negative_prompt: 'nsfw, nude, bad quality',
                    width: 512,
                    height: 512,
                    guidance_scale: 7.5,
                    num_inference_steps: 50,
                    num_images: 1,
                    safety_checker: true
                })
            });

            if (!response.ok) {
                throw new Error(`ModelsLab API error: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.images && data.images.length > 0) {
                res.json({
                    success: true,
                    imageUrl: data.images[0]
                });
            } else {
                throw new Error('No image generated');
            }

        } catch (error) {
            console.error('Image Generation Error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate image. Please try again.'
            });
        }

    } catch (error) {
        console.error('Image Generation Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate image. Please try again.'
        });
    }
});

// Image analysis endpoint
app.post('/api/analyze-image', async (req, res) => {
    try {
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res.status(400).json({
                success: false,
                error: 'Image URL is required'
            });
        }

        // Initialize the Gemini Pro Vision model
        const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

        try {
            // Generate content about the image
            const result = await model.generateContent([
                "Analyze this image and describe what you see.",
                { inlineData: { mimeType: "image/jpeg", data: imageUrl } }
            ]);
            
            const response = await result.response;
            const description = response.text();

            res.json({
                success: true,
                description: description
            });
        } catch (error) {
            console.error('Vision Analysis Error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to analyze image'
            });
        }
    } catch (error) {
        console.error('Server Error:', error);
        res.status(500).json({
            success: false,
            error: 'An unexpected error occurred'
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});