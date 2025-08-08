const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../config'); 
const logger = require('../Core/logger');  


class GeminiVisionModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'gvision';
        this.metadata = {
            description: 'Analyzes images and videos using Google Gemini Vision API.',
            version: '2.6.0',
            author: 'Your Name',
            category: 'ai'
        };

        this.genAI = null;
        this.visionModel = null;
        // --- ADD YOUR API KEY HERE ---
        this.apiKey = "AIzaSyC1-5hrYIdfNsg2B7bcb5Qs3ib1MIWlbOE";


        this.commands = [
            {
                name: 'whatisthis',
                description: 'Describes the content of an image.',
                usage: '.whatisthis (reply to an image)',
                permissions: 'public',
                ui: {
                    processingText: '🖼️ *Analyzing Image...*\n\nLet me take a look...',
                    errorText: '❌ *Image Analysis Failed*'
                },
                execute: this.identifyImage.bind(this)
            },
            {
                name: 'ocr',
                description: 'Reads and extracts text from an image.',
                usage: '.ocr (reply to an image)',
                permissions: 'public',
                ui: {
                    processingText: '📄 *Reading Text...*\n\nScanning for words...',
                    errorText: '❌ *OCR Failed*'
                },
                execute: this.extractText.bind(this)
            },
            {
                name: 'identify',
                description: 'Identifies a person, animal, plant, or landmark in an image.',
                usage: '.identify (reply to an image)',
                permissions: 'public',
                ui: {
                    processingText: '🧐 *Identifying...*\n\nSearching for details...',
                    errorText: '❌ *Identification Failed*'
                },
                execute: this.identifyEntity.bind(this)
            },
            {
                name: 'recipe',
                description: 'Creates a recipe from a picture of ingredients.',
                usage: '.recipe (reply to an image of food)',
                permissions: 'public',
                ui: {
                    processingText: '🧑‍🍳 *Creating Recipe...*\n\nThinking of something tasty...',
                    errorText: '❌ *Recipe Creation Failed*'
                },
                execute: this.createRecipe.bind(this)
            },
            {
                name: 'caption',
                description: 'Generates a social media caption for an image.',
                usage: '.caption (reply to an image)',
                permissions: 'public',
                ui: {
                    processingText: '✍️ *Writing Caption...*\n\nGetting creative...',
                    errorText: '❌ *Caption Generation Failed*'
                },
                execute: this.generateCaption.bind(this)
            },
            {
                name: 'explainmeme',
                description: 'Explains the context and humor of a meme.',
                usage: '.explainmeme (reply to a meme image)',
                permissions: 'public',
                ui: {
                    processingText: '😂 *Explaining Meme...*\n\nLet me get the joke...',
                    errorText: '❌ *Meme Explanation Failed*'
                },
                execute: this.explainMeme.bind(this)
            },
            {
                name: 'artstyle',
                description: 'Analyzes the art style of an image.',
                usage: '.artstyle (reply to an artwork)',
                permissions: 'public',
                ui: {
                    processingText: '🎨 *Analyzing Art Style...*\n\nConsulting my inner art critic...',
                    errorText: '❌ *Art Analysis Failed*'
                },
                execute: this.analyzeArtStyle.bind(this)
            },
            {
                name: 'detect',
                description: 'Detects and lists objects in an image.',
                usage: '.detect (reply to an image)',
                permissions: 'public',
                ui: {
                    processingText: '🔍 *Detecting Objects...*\n\nIdentifying items...',
                    errorText: '❌ *Object Detection Failed*'
                },
                execute: this.detectObjects.bind(this)
            },
            // --- VIDEO COMMANDS ---
            {
                name: 'summarizevideo',
                description: 'Summarizes the content of a video.',
                usage: '.summarizevideo (reply to a video)',
                permissions: 'public',
                ui: {
                    processingText: '🎬 *Summarizing Video...*\n\nWatching and taking notes...',
                    errorText: '❌ *Video Summary Failed*'
                },
                execute: this.summarizeVideo.bind(this)
            },
            {
                name: 'askvideo',
                description: 'Asks a specific question about a video.',
                usage: '.askvideo <question> (reply to a video)',
                permissions: 'public',
                ui: {
                    processingText: '🤔 *Analyzing Video for Answer...*\n\nPlease wait...',
                    errorText: '❌ *Could not find an answer in the video.*'
                },
                execute: this.askVideo.bind(this)
            },
            {
                name: 'videofacts',
                description: 'Extracts key facts from a video.',
                usage: '.videofacts (reply to a video)',
                permissions: 'public',
                ui: {
                    processingText: '📈 *Extracting Facts...*\n\nAnalyzing video data...',
                    errorText: '❌ *Fact Extraction Failed*'
                },
                execute: this.videoFacts.bind(this)
            },
            // --- UNIVERSAL MEDIA COMMANDS ---
            {
                name: 'productfinder',
                description: 'Finds products in an image or video.',
                usage: '.productfinder (reply to media)',
                permissions: 'public',
                ui: {
                    processingText: '🛍️ *Finding Products...*\n\nScanning for items...',
                    errorText: '❌ *Product identification failed*'
                },
                execute: this.productFinder.bind(this)
            },
            {
                name: 'scenedescriber',
                description: 'Describes the visual scenes in media.',
                usage: '.scenedescriber (reply to media)',
                permissions: 'public',
                ui: {
                    processingText: '👁️ *Describing Scene...*\n\nLooking closely...',
                    errorText: '❌ *Scene description failed*'
                },
                execute: this.sceneDescriber.bind(this)
            }
        ];
    }

    /**
     * Initializes the Gemini client. This is called when the module is loaded.
     */
    async init() {
        if (!this.apiKey || this.apiKey === "YOUR_GEMINI_API_KEY_HERE") {
            logger.error('Gemini API key is missing from the gemini-vision.js module file.');
            throw new Error('Gemini API key not configured. Please add it directly to the module file.');
        }
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        this.visionModel = this.genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ]
        });

    }

    /**
     * Helper function to find the replied-to message containing media (image or video).
     * @param {object} msg - The original message object from Baileys.
     * @returns {{mediaMessage: object, mediaType: string}|null} The media message and its type, or null.
     */
    _getRepliedMediaMessage(msg) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg?.imageMessage) {
            return { mediaMessage: quotedMsg.imageMessage, mediaType: 'image' };
        }
        if (quotedMsg?.videoMessage) {
            return { mediaMessage: quotedMsg.videoMessage, mediaType: 'video' };
        }
        return null;
    }

    /**
     * Helper function to download media from a message and convert it to a buffer.
     * @param {object} mediaMessage - The media message object.
     * @param {string} mediaType - The type of media ('image' or 'video').
     * @returns {Promise<Buffer>} A promise that resolves with the media buffer.
     */
    async _getMediaBuffer(mediaMessage, mediaType) {
        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

    /**
     * A generic function to run a vision prompt against the Gemini API.
     * @param {string} prompt - The text prompt to send with the media.
     * @param {Buffer} mediaBuffer - The media data as a buffer.
     * @param {string} mimeType - The MIME type of the media (e.g., 'image/jpeg', 'video/mp4').
     * @returns {Promise<string>} The text response from the Gemini model.
     */
    async _runVisionModel(prompt, mediaBuffer, mimeType) {
        if (!this.visionModel) {
            throw new Error('Gemini Vision model is not initialized.');
        }

        const mediaPart = {
            inlineData: {
                data: mediaBuffer.toString("base64"),
                mimeType,
            },
        };

        const result = await this.visionModel.generateContent([prompt, mediaPart]);
        const response = await result.response;
        return response.text();
    }

    // --- IMAGE COMMANDS ---

    async identifyImage(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to an image to use this command.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "Describe this image in detail. Be as descriptive as possible about the scene, objects, and any potential context.";
        
        const description = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*🖼️ Image Analysis Result:*\n\n${description}`;
    }

    async extractText(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to an image to use this command.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "Extract all text from this image, preserving the original formatting and line breaks as much as possible. If no text is visible, state that clearly.";

        const extractedText = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*📄 Extracted Text (OCR):*\n\n${extractedText}`;
    }

    async identifyEntity(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to an image to use this command.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "Identify the main subject in this image. If it is a well-known public figure, landmark, or specific species of animal/plant, provide its name and a brief, interesting detail. If you are not confident or if the subject is a private individual, state that you cannot identify them and provide a general description instead.";

        const identification = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*🧐 Identification Result:*\n\n${identification}`;
    }

    async createRecipe(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to an image of ingredients to use this command.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "Based on the ingredients shown in this image, create a simple, easy-to-follow recipe. List the ingredients and provide step-by-step instructions.";

        const recipe = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*🧑‍🍳 Here's a recipe you can make:*\n\n${recipe}`;
    }

    async generateCaption(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to an image to generate a caption.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "Generate a creative and engaging social media caption for this image. Include 2-3 relevant emojis and 3-4 appropriate hashtags.";

        const caption = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*✍️ Generated Caption:*\n\n${caption}`;
    }

    async explainMeme(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to a meme to use this command.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "This image is a meme. Please explain its origin, format, and the type of humor it represents. Describe why it is considered funny.";

        const explanation = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*😂 Meme Explained:*\n\n${explanation}`;
    }

    async analyzeArtStyle(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to an artwork to use this command.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "Analyze the art style of this image. Identify the movement (e.g., Impressionism, Surrealism, Pop Art), describe its key characteristics, and name a famous artist associated with this style.";

        const analysis = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*🎨 Art Style Analysis:*\n\n${analysis}`;
    }

    async detectObjects(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'image') {
            return "Please reply to an image to use this command.";
        }

        const imageBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'image');
        const prompt = "List all the distinct objects you can identify in this image as a simple bulleted list. Do not describe the scene.";

        const objects = await this._runVisionModel(prompt, imageBuffer, "image/jpeg");
        return `*🔍 Detected Objects:*\n\n${objects}`;
    }

    // --- VIDEO COMMANDS ---

    async summarizeVideo(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'video') {
            return "Please reply to a video to use this command.";
        }

        const videoBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'video');
        const prompt = "Summarize the content of this video. Describe the main events, topics, and overall message.";

        const summary = await this._runVisionModel(prompt, videoBuffer, "video/mp4");
        return `*🎬 Video Summary:*\n\n${summary}`;
    }

    async askVideo(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'video') {
            return "Please reply to a video to ask a question about it.";
        }
        if (params.length === 0) {
            return "Please provide a question after the command. Usage: .askvideo <your question>";
        }

        const question = params.join(' ');
        const videoBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'video');
        const prompt = `Based on the content of this video, please answer the following question: "${question}"`;

        const answer = await this._runVisionModel(prompt, videoBuffer, "video/mp4");
        return `*🤔 Question:* ${question}\n\n*💬 Answer from Video:*\n${answer}`;
    }

    async videoFacts(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData || mediaData.mediaType !== 'video') {
            return "Please reply to a video to use this command.";
        }

        const videoBuffer = await this._getMediaBuffer(mediaData.mediaMessage, 'video');
        const prompt = "Watch this video and extract a list of key facts or data points mentioned. Present them as a clear, bulleted list.";

        const facts = await this._runVisionModel(prompt, videoBuffer, "video/mp4");
        return `*📈 Key Facts from Video:*\n\n${facts}`;
    }

    // --- UNIVERSAL MEDIA COMMANDS ---

    async productFinder(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData) {
            return "Please reply to an image or video to find products.";
        }

        const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
        const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
        const prompt = "Identify any commercial products visible in this media. For each product, provide its name, brand (if possible), and a brief description.";

        const products = await this._runVisionModel(prompt, mediaBuffer, mimeType);
        return `*🛍️ Products Found:*\n\n${products}`;
    }

    async sceneDescriber(msg, params, context) {
        const mediaData = this._getRepliedMediaMessage(msg);
        if (!mediaData) {
            return "Please reply to an image or video to describe the scene.";
        }

        const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
        const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
        const prompt = "Provide a detailed, narrative description of the visual scenes in this media. Focus on the setting, actions, and overall atmosphere. This is for an accessibility feature, so be descriptive.";

        const description = await this._runVisionModel(prompt, mediaBuffer, mimeType);
        return `*👁️ Scene Description:*\n\n${description}`;
    }


}

module.exports = GeminiVisionModule;
