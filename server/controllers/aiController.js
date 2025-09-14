import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import FormData from "form-data";
import fs from 'fs'
import pdf from 'pdf-parse/lib/pdf-parse.js'


const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});


export const generateArticle = async (req ,res )=>{
    try {
        const {userId} = req.auth;
        const {prompt,length} = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if(plan !== 'premium' && free_usage >= 10){
            return res.json({success:false,message:'Limit reached. Upgrade to continue'})
        }

    const response = await AI.chat.completions.create({
        model: "gemini-2.0-flash",
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],

        temperature: 0.7,
        max_tokens: length,
        
        });

        const content = response.choices[0].message.content

        await sql `INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${prompt}, ${content}, 'article')`;

        if(plan !== 'premium'){
            await clerkClient.users.updateUserMetadata(userId,{
                privateMetadata:{
                    free_usage: free_usage + 1
                }
            })
        }

        res.json({success:true, content})


    } catch (error) {
        console.log(error.message)
        res.json({success:false , message: error.message})
    }
}


export const generateBlogTitle = async (req ,res )=>{
    try {
        const {userId} = req.auth;
        const {prompt} = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if(plan !== 'premium' && free_usage >= 10){
            return res.json({success:false,message:'Limit reached. Upgrade to continue'})
        }

    const response = await AI.chat.completions.create({
        model: "gemini-2.0-flash",
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],

        temperature: 0.7,
        max_tokens: 100,
        
        });

        const content = response.choices[0].message.content

        await sql `INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;

        if(plan !== 'premium'){
            await clerkClient.users.updateUserMetadata(userId,{
                privateMetadata:{
                    free_usage: free_usage + 1
                }
            })
        }

        res.json({success:true, content})


    } catch (error) {
        console.log(error.message)
        res.json({success:false , message: error.message})
    }
}

export const generateImage = async (req, res) => {
    try {
        const { userId } = req.auth; // Assuming req.auth is an object with a userId property
        const { prompt, publish } = req.body;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.status(403).json({ success: false, message: 'This feature is available in premium plan' });
        }

        const formData = new FormData();
        formData.append('prompt', prompt);

        // Call the external image generation API
        const { data } = await axios.post('https://clipdrop-api.co/text-to-image/v1', formData, {
            headers: {
                'x-api-key': process.env.CLIPDROP_API_KEY
            },
            responseType: 'arraybuffer',
        });

        // Convert the image buffer to a base64 string for uploading
        const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`;
        
        // Upload the image to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(base64Image);
        const { secure_url } = uploadResult;


        // Save the creation record to the database
        await sql`INSERT INTO creations (user_id, prompt, content, type, publish) 
                  VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})`;
        
        // Send the final image URL back to the client
        res.json({ success: true, secure_url });

    } catch (error) {
    console.error("Error generating image:", error);
    res.status(500).json({ 
        success: false, 
        message: "Failed to generate image due to a server error.", 
        error: error.message, // send actual error back
        stack: error.stack    // helpful for debugging locally
    });
}
};


export const removeImageBackground = async (req, res) => {
    try {
        const { userId } = req.auth; // Assuming req.auth is an object with a userId property
        const image = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.status(403).json({ success: false, message: 'This feature is available in premium plan' });
        }

        const { secure_url } = await cloudinary.uploader.upload(image.path, {
            transformation:[
                {
                    effect: 'background_removal',
                    background_removal: 'remove_the_background'
                }
            ]
        });

        // Save the creation record to the database
        await sql`INSERT INTO creations (user_id, prompt, content, type) 
                  VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')`;
        
        // Send the final image URL back to the client
        res.json({ success: true, secure_url });

    } catch (error) {
    console.error("Error generating image:", error);
    res.status(500).json({ 
        success: false, 
        message: error.message
    });
}
};


export const removeImageObject = async (req, res) => {
    try {
        const { userId } = req.auth;
        const { object } = req.body; 
        const image = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.status(403).json({ success: false, message: 'This feature is available in premium plan' });
        }
 
        const uploadResult = await cloudinary.uploader.upload(image.path);
        const { public_id } = uploadResult;

        const secure_url = cloudinary.url(public_id,{
            transformation:[
                {
                    effect: `gen_remove:${object}`
                }
            ],
            resource_type: 'image'
        })

        // Save the creation record to the database
        await sql`INSERT INTO creations (user_id, prompt, content, type) 
                  VALUES (${userId},${`Removed ${object} from image`}, ${secure_url}, 'image')`;
        
        // Send the final image URL back to the client
        res.json({ success: true, secure_url});

    } catch (error) {
    console.error("Error generating image:", error);
    res.status(500).json({ 
        success: false, 
        message: error.message   // helpful for debugging locally
    });
}
};


export const resumeReview = async (req, res) => {
    try {
        const { userId } = req.auth; 
        const resume = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.status(403).json({ success: false, message: 'This feature is available in premium plan' });
        }
 
        if(resume.size > 5 * 1024 * 1024){
            return res.json({success:false, message:"Resume file size exceeds allowed size (5MB)"})
        }

        const dataBuffer = fs.readFileSync(resume.path)

        const pdfData = await pdf(dataBuffer);

        const prompt = `Review the following resume and provide constructive 
        feedback on its strength, weakness, and areas for improvement. Resume Content:\n\n${pdfData.text}`

        const response = await AI.chat.completions.create({
            model: "gemini-2.0-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],

            temperature: 0.7,
            max_tokens: 4096,
            
        });

        const content = response.choices[0].message.content

        
        await sql`INSERT INTO creations (user_id, prompt, content, type) 
                  VALUES (${userId},${`Review the uploaded resume`}, ${content}, 'resume-review')`;
        
        // Send the final image URL back to the client
        res.json({ success: true, content});

    } catch (error) {
    console.error("Error generating image:", error);
    res.status(500).json({ 
        success: false, 
        message: error.message
    });
}
};



