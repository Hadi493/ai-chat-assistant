require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        
        res.json({ 
            success: true,
            reply: text
        });
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
