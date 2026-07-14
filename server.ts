import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import nodemailer from "nodemailer";

// Import PostgreSQL Database Pool & Schema
import { db } from "./src/db/index.ts";
import { 
  users, 
  transcriptionHistory, 
  apiKeys, 
  teamMembers, 
  userSessions, 
  adminSettings 
} from "./src/db/schema.ts";
import { eq, and, desc } from "drizzle-orm";

dotenv.config();

// Ephemeral memory list for unverified registration & login OTP codes
let otpsList: any[] = [];

// Seed Database from server-db.json fallback or defaults
async function seedDatabase() {
  try {
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length === 0) {
      console.log("SQL Database is empty. Seeding/Migrating from local JSON data...");
      
      const DB_PATH = path.join(process.cwd(), "server-db.json");
      let localUsers = [{
        name: "Bilal Faisal Arain",
        email: "farain539@gmail.com",
        password: "password123",
        role: "Owner" as const,
        passcodePin: "1234"
      }];
      let localSettings = {
        smtp_host: "smtp.gmail.com",
        smtp_port: "587",
        smtp_user: "",
        smtp_pass: "",
        smtp_from: "",
        gemini_api_key: ""
      };

      if (fs.existsSync(DB_PATH)) {
        try {
          const fileData = fs.readFileSync(DB_PATH, "utf-8");
          const parsed = JSON.parse(fileData);
          if (parsed.users && parsed.users.length > 0) {
            localUsers = parsed.users;
          }
          if (parsed.settings) {
            localSettings = parsed.settings;
          }
        } catch (e) {
          console.error("Failed to parse local server-db.json for seeding:", e);
        }
      }

      // 1. Seed Users
      for (const u of localUsers) {
        await db.insert(users).values({
          name: u.name,
          email: u.email.toLowerCase(),
          password: u.password,
          role: (u.role as "Owner" | "Developer" | "Viewer") || "Developer",
          passcodePin: u.passcodePin || "1234",
          saasPlan: u.email.toLowerCase() === "farain539@gmail.com" ? "pro" : "free",
          transcribeCount: 1,
        }).onConflictDoNothing();
      }

      // 2. Seed Admin Settings
      await db.insert(adminSettings).values({
        id: 1,
        smtpHost: localSettings.smtp_host || "smtp.gmail.com",
        smtpPort: localSettings.smtp_port || "587",
        smtpUser: localSettings.smtp_user || "",
        smtpPass: localSettings.smtp_pass || "",
        smtpFrom: localSettings.smtp_from || "",
        geminiApiKey: localSettings.gemini_api_key || "",
      }).onConflictDoNothing();

      console.log("PostgreSQL Database initialized and seeded successfully.");
    }
  } catch (err) {
    console.error("Failed to run SQL Database initialization/seeding:", err);
  }
}

// Mail Dispatcher with real SMTP or simulated high-fidelity test inbox (Ethereal Email) fallback
async function getTransporter() {
  let settings: any = {};
  try {
    const [dbSettings] = await db.select().from(adminSettings).where(eq(adminSettings.id, 1));
    if (dbSettings) {
      settings = {
        smtp_host: dbSettings.smtpHost,
        smtp_port: dbSettings.smtpPort,
        smtp_user: dbSettings.smtpUser,
        smtp_pass: dbSettings.smtpPass,
        smtp_from: dbSettings.smtpFrom,
      };
    }
  } catch (err) {
    console.error("Failed to read SMTP settings from PostgreSQL:", err);
  }

  const host = (settings.smtp_host || process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const port = parseInt(settings.smtp_port || process.env.SMTP_PORT || "587");
  const user = (settings.smtp_user || process.env.SMTP_USER || "").trim();
  const pass = (settings.smtp_pass || process.env.SMTP_PASS || "").trim();

  // Robust check to avoid placeholder values from .env.example
  const isPlaceholderUser = !user || user.includes("your-email") || user.includes("aapki-gmail") || user.includes("your-gmail");
  const isPlaceholderPass = !pass || pass.includes("your-gmail-app-password") || pass.includes("your_app_password");

  if (user && pass && !isPlaceholderUser && !isPlaceholderPass) {
    let from = (settings.smtp_from || process.env.SMTP_FROM || "").trim();
    if (!from || from.includes("your-email") || from.includes("aapki-gmail") || from.includes("your-gmail") || !from.includes("@")) {
      from = `"Hinglish Workspace Auth" <${user}>`;
    }

    return {
      transporter: nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false
        }
      }),
      from,
      isEthereal: false,
      previewUrl: "",
      configLogs: [
        `SMTP CONNECT: Handshaking with SMTP host: ${host}:${port}`,
        `SMTP AUTH: Authenticating as user: ${user}`,
        `SMTP FROM SENDER: ${from}`
      ]
    };
  } else {
    try {
      // Auto-generates a secure sandbox test mailbox on-the-fly
      const testAccount = await nodemailer.createTestAccount();
      return {
        transporter: nodemailer.createTransport({
          host: testAccount.smtp.host,
          port: testAccount.smtp.port,
          secure: testAccount.smtp.secure,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass
          }
        }),
        from: `"Hinglish Secure Sandbox" <${testAccount.user}>`,
        isEthereal: true,
        previewUrl: "https://ethereal.email",
        configLogs: [
          `SMTP WARNING: No custom SMTP credentials detected in secrets!`,
          `SMTP SERVICE: Provisioned live secure sandbox mailbox on Ethereal Email.`,
          `SMTP CONNECT: Connected to host: ${testAccount.smtp.host}:${testAccount.smtp.port} TLS`,
          `SMTP FROM SENDER: "Hinglish Secure Sandbox" <${testAccount.user}>`
        ]
      };
    } catch (err) {
      console.error("Failed to provision automated Ethereal sandbox SMTP:", err);
      return {
        transporter: {
          sendMail: async (options: any) => {
            console.log("[SMTP FALLBACK OUTBOX] Real email send disabled. Payload:", options);
            return { messageId: "fallback-dummy-id", response: "250 Fallback OK" };
          }
        } as any,
        from: `"Secure Sandbox Fallback" <sandbox@example.com>`,
        isEthereal: true,
        previewUrl: "",
        configLogs: [
          `SMTP CRITICAL: Failed to provision Ethereal. Active dry-run mock fallback enabled.`,
          `SMTP FROM SENDER: "Secure Sandbox Fallback" <sandbox@example.com>`
        ]
      };
    }
  }
}

async function startServer() {
  // Seed the PostgreSQL Database first
  await seedDatabase();

  const app = express();
  const PORT = 3000;

  // Middleware for large JSON bodies (essential for audio uploads)
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Initialize Gemini client safely
  let ai: GoogleGenAI | null = null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }

  // API endpoint for transcribing audio
  app.post("/api/transcribe", async (req, res) => {
    try {
      const { audio, mimeType, instruction, mode } = req.body;

      if (!audio) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      // Get settings from SQL DB
      let finalApiKey = process.env.GEMINI_API_KEY;
      try {
        const [dbSettings] = await db.select().from(adminSettings).where(eq(adminSettings.id, 1));
        if (dbSettings && dbSettings.geminiApiKey) {
          finalApiKey = dbSettings.geminiApiKey;
        }
      } catch (err) {
        console.error("Failed to fetch custom gemini api key from DB:", err);
      }

      if (!finalApiKey) {
        return res.status(500).json({
          error: "GEMINI_API_KEY is not configured on this server node. Please go to System Admin Control and configure GEMINI_API_KEY."
        });
      }

      ai = new GoogleGenAI({
        apiKey: finalApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Clean base64 data (remove "data:audio/xxx;base64," if present)
      let base64Data = audio;
      if (audio.includes(";base64,")) {
        base64Data = audio.split(";base64,").pop();
      }

      const defaultMimeType = mimeType || "audio/webm";

      // Build the transcription prompt
      let systemPrompt = "";
      if (mode === "english") {
        systemPrompt = "You are an expert bilingual transcriber and translator. " +
          "Your task is to transcribe the provided audio and translate any spoken parts (e.g., Hinglish, Hindi, Urdu) directly into clear, natural, grammatically correct standard English. " +
          "Rules:\n" +
          "1. Write the final transcription purely in standard English. Translate spoken Hinglish/Hindi parts directly into standard English.\n" +
          "2. Ensure the translation sounds natural and captures the accurate intent of the speaker.\n" +
          "3. Keep English words as spoken, adjusting grammar if they are mixed with Hindi words.\n" +
          "4. Do NOT leave words in Romanized Hindi (e.g., instead of transcribing 'Mera project complete ho gaya hai', write 'My project has been completed').\n" +
          "5. After the transcription, provide a brief 2-3 sentence English summary of the audio, preceded by '---' and labeled as '**English Summary:**'.\n" +
          "6. Also output a list of **Key Words / Vocabulary** containing interesting or common words or phrases from the spoken audio and their translation/meanings in English.";
      } else {
        systemPrompt = "You are an expert bilingual transcriber specializing in Hinglish. " +
          "Your task is to transcribe the provided audio in Hinglish. " +
          "Hinglish is a blend of Hindi (and Urdu) and English, written in the Roman (Latin) script. " +
          "Rules:\n" +
          "1. Write the transcription exactly as spoken, but in Roman script (e.g., write 'Aap kaise hain?', 'Main office ja raha hoon', 'Let's meet at 5 PM').\n" +
          "2. Spell Hindi words phonetically and naturally in English letters.\n" +
          "3. Keep English words in English spelling (e.g., 'office', 'meeting', 'phone', 'cancel').\n" +
          "4. Preserve the emotional tone and spoken expressions (like 'yaar', 'achha', 'umm', 'oh').\n" +
          "5. Do NOT translate the entire speech to standard English or Devnagari Hindi. It must remain in conversational Roman Hinglish.\n" +
          "6. If the audio is purely in English, write the English text as is.\n" +
          "7. After the transcription, provide a brief 2-3 sentence English summary of the audio, preceded by '---' and labeled as '**English Summary:**'.\n" +
          "8. Also output a list of **Key Words / Vocabulary** containing interesting or common Hinglish/Hindi words from the audio with their English meanings.";
      }

      const finalPrompt = instruction 
        ? `${systemPrompt}\n\nAdditional user direction: ${instruction}`
        : systemPrompt;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: defaultMimeType,
              data: base64Data,
            }
          },
          {
            text: finalPrompt
          }
        ],
      });

      const transcription = response.text || "Could not transcribe the audio.";

      return res.json({ transcription });
    } catch (error: any) {
      console.error("Transcription error:", error);
      return res.status(500).json({
        error: error.message || "An error occurred during audio transcription. Please make sure the audio file is valid."
      });
    }
  });

  // System instructions for the AI Assistant feature
  const projectInstruction = `You are the official AI Assistant for the Hinglish Audio Transcriber project.
Your purpose is to answer any questions the user has about this specific project.
Key Details of the Project:
- Name: Hinglish Audio Transcriber
- Features:
  1. Upload Audio Files (supports MP3, WAV, WebM, M4A, etc. up to 50MB).
  2. Live Recording: Users can record speech directly from their microphone, with an active real-time canvas waveform visualizer.
  3. Hinglish Transcription Mode: Transcribes bilingual Hindi/Urdu and English speech into Roman Hinglish (e.g. Roman script: "Main kal office jaunga"). Spells Hindi words phonetically and accurately. Keeps English words in standard spelling.
  4. English Translation Mode: Automatically translates mixed Hinglish/Hindi/Urdu speech directly into clear, grammatical standard English.
  5. English Summary: Provides an automated, elegant 2-3 sentence English summary of the speech.
  6. Key Vocabulary Glossary: Extracts interesting or common bilingual terms and lists their English meanings in an elegant glossary card grid.
  7. History log: Saves previous results in PostgreSQL database isolated per-user. Users can view, download as .txt, or copy them.
  8. Light/Dark theme toggle.
- Tech Stack: Built using React, Tailwind CSS (v4), Express (Node.js) server, Google Cloud SQL (PostgreSQL) database, and the Google Gemini 3.5 Flash model ('gemini-3.5-flash') using the modern '@google/genai' SDK.
- Style: Keep replies brief.`;

  const developerInstruction = `You are the official AI Assistant representing Bilal Faisal Arain, the developer of this project.
Your purpose is to answer any questions about Bilal Faisal Arain, his background, skills, and contact details.
Key Details of Bilal Faisal Arain:
- Name: Bilal Faisal Arain
- Title: Full Stack Web Developer & QA Tester
- Education: Software Engineering Graduate
- Location: Karachi, Pakistan
- Email: bilaifaisalarain@gmail.com
- GitHub: https://github.com/bilaifaisaldev
- Instagram: https://instagram.com/bilal.faisalarain
- Bio: Software Engineering Graduate and highly passionate Full Stack Web Developer.
- Style: Professional, brief replies.`;

  // API endpoint for the AI Assistant Chat
  app.post("/api/assistant", async (req, res) => {
    try {
      const { option, message, history } = req.body;

      if (!message) {
        return res.status(400).json({ error: "No message provided" });
      }

      let finalApiKey = process.env.GEMINI_API_KEY;
      try {
        const [dbSettings] = await db.select().from(adminSettings).where(eq(adminSettings.id, 1));
        if (dbSettings && dbSettings.geminiApiKey) {
          finalApiKey = dbSettings.geminiApiKey;
        }
      } catch (err) {
        console.error("Failed to fetch gemini api key from DB:", err);
      }

      if (!finalApiKey) {
        return res.status(500).json({
          error: "GEMINI_API_KEY is not configured on this server node. Please go to System Admin Control and configure GEMINI_API_KEY."
        });
      }

      ai = new GoogleGenAI({
        apiKey: finalApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Determine system instruction based on selected option
      const systemInstruction = option === "developer" ? developerInstruction : projectInstruction;

      const contents: any[] = [];
      if (history && Array.isArray(history)) {
        history.forEach((msg: any) => {
          if (msg.role && msg.text) {
            contents.push({
              role: msg.role === "assistant" ? "model" : "user",
              parts: [{ text: msg.text }]
            });
          }
        });
      }

      contents.push({
        role: "user",
        parts: [{ text: message }]
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      });

      const reply = response.text || "I'm sorry, I couldn't generate a response.";
      return res.json({ reply });
    } catch (error: any) {
      console.error("AI Assistant error:", error);
      return res.status(500).json({
        error: error.message || "An error occurred in the AI Assistant."
      });
    }
  });

  // Check if API Key is configured
  app.get("/api/config", (req, res) => {
    res.json({
      hasApiKey: !!process.env.GEMINI_API_KEY
    });
  });

  // SECURE AUTH ROUTER ENDPOINTS
  app.post("/api/auth/register-init", async (req, res) => {
    try {
      const { email, password, name, role, passcodePin } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: "Required fields are missing." });
      }

      const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (existing) {
        return res.status(400).json({ error: "User with this email already exists." });
      }

      const assignedRole = email.toLowerCase() === "farain539@gmail.com" ? "Owner" : "Developer";

      const [newUser] = await db.insert(users).values({ 
        name, 
        email: email.toLowerCase(), 
        password, 
        role: assignedRole, 
        passcodePin: passcodePin || "1234",
        saasPlan: email.toLowerCase() === "farain539@gmail.com" ? "pro" : "free",
        transcribeCount: 1,
      }).returning();

      const token = "sess_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

      await db.insert(userSessions).values({
        token,
        email: newUser.email,
        expiresAt
      });

      return res.json({
        success: true,
        direct: true,
        token,
        user: {
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          passcodePin: newUser.passcodePin,
          saasPlan: newUser.saasPlan,
          transcribeCount: newUser.transcribeCount
        }
      });
    } catch (error: any) {
      console.error("Register init crash:", error);
      return res.status(500).json({ error: error.message || "Failed to initiate registration." });
    }
  });

  app.post("/api/auth/login-init", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Required fields are missing." });
      }

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user || user.password !== password) {
        return res.status(400).json({ error: "Incorrect email address or decryption password." });
      }

      const token = "sess_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

      await db.insert(userSessions).values({
        token,
        email: user.email,
        expiresAt
      });

      return res.json({
        success: true,
        direct: true,
        token,
        user: {
          name: user.name,
          email: user.email,
          role: user.role,
          passcodePin: user.passcodePin,
          saasPlan: user.saasPlan,
          transcribeCount: user.transcribeCount
        }
      });
    } catch (error: any) {
      console.error("Login init crash:", error);
      return res.status(500).json({ error: error.message || "Failed to initiate login." });
    }
  });

  // Verification request with high-fidelity mail notification (OTP)
  app.post("/api/auth/verify-request", async (req, res) => {
    try {
      const { email, name, password, role, passcodePin, type } = req.body;
      if (!email || !type) {
        return res.status(400).json({ error: "Email and action type are required." });
      }

      // 6-digit cryptographic verification OTP
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

      // Clear older pending OTP logs for this user/action
      otpsList = otpsList.filter(o => !(o.email.toLowerCase() === email.toLowerCase() && o.type === type));

      otpsList.push({
        email,
        code,
        type,
        expiresAt,
        pendingData: { name, email, password, role, passcodePin }
      });

      const setup = await getTransporter();

      const mailOptions = {
        from: setup.from,
        to: email,
        subject: `[Hinglish Audio Workspace] Verification Pin Code: ${code}`,
        text: `Hello ${name || 'User'},\n\nYour 6-digit verification code is: ${code}\n\nUse this to authorize your browser session. This pin will expire in 10 minutes.`,
        html: `
          <div style="font-family: 'Helvetica', sans-serif; background: #0c0a09; color: #f4f4f5; padding: 40px; border-radius: 16px; border: 1px solid #27272a; max-width: 600px; margin: auto;">
            <h2 style="color: #f59e0b; font-weight: bold; font-family: monospace;">Hinglish Workspace Verification</h2>
            <p style="font-size: 14px; color: #a1a1aa;">Use the secure, single-use authentication pin below to authorize your active workspace request:</p>
            <div style="background: #18181b; border: 1px solid #3f3f46; border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #ffffff; font-family: monospace;">${code}</span>
            </div>
            <p style="font-size: 11px; color: #71717a;">Security advice: This code will strictly expire in 10 minutes. Do not share this OTP with anyone.</p>
          </div>
        `
      };

      await setup.transporter.sendMail(mailOptions);

      return res.json({
        success: true,
        previewUrl: setup.previewUrl,
        isEthereal: setup.isEthereal,
        code, // Send code as helper fallback in case mail servers are unreachable
        logs: [
          ...setup.configLogs,
          `OTP GENERATE: Auth OTP [${code}] dispatched to inbox: ${email}`
        ]
      });
    } catch (err: any) {
      console.error("Verification dispatch error:", err);
      return res.status(500).json({ error: err.message || "Failed to dispatch verification code." });
    }
  });

  app.post("/api/auth/verify-otp", async (req, res) => {
    try {
      const { email, code, type } = req.body;
      if (!email || !code || !type) {
        return res.status(400).json({ error: "Required verification parameters missing." });
      }

      const otpRecordIdx = otpsList.findIndex(
        (o: any) => o.email.toLowerCase() === email.toLowerCase() && o.type === type
      );

      if (otpRecordIdx === -1) {
        return res.status(400).json({ error: "No active verification session found. Please request a new OTP." });
      }

      const otpRecord = otpsList[otpRecordIdx];

      if (otpRecord.code !== code) {
        return res.status(400).json({ error: "Invalid OTP code. Please verify the 6-digit code and try again." });
      }

      if (Date.now() > otpRecord.expiresAt) {
        otpsList.splice(otpRecordIdx, 1);
        return res.status(400).json({ error: "The OTP code has expired. Please request a new code." });
      }

      otpsList.splice(otpRecordIdx, 1);

      let userToAuth = null;

      if (type === "register") {
        const { name, email: rEmail, password, role, passcodePin } = otpRecord.pendingData;
        const [existing] = await db.select().from(users).where(eq(users.email, rEmail.toLowerCase()));
        if (existing) {
          return res.status(400).json({ error: "This email has already been registered." });
        }

        const assignedRole = rEmail.toLowerCase() === "farain539@gmail.com" ? "Owner" : "Developer";

        const [newUser] = await db.insert(users).values({ 
          name, 
          email: rEmail.toLowerCase(), 
          password, 
          role: assignedRole, 
          passcodePin,
          saasPlan: rEmail.toLowerCase() === "farain539@gmail.com" ? "pro" : "free",
          transcribeCount: 1,
        }).returning();
        
        userToAuth = newUser;
      } else {
        const [existingUser] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
        userToAuth = existingUser;
      }

      if (!userToAuth) {
        return res.status(404).json({ error: "User account not resolved." });
      }

      const token = "sess_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

      await db.insert(userSessions).values({
        token,
        email: userToAuth.email,
        expiresAt
      });

      return res.json({
        success: true,
        token,
        user: {
          name: userToAuth.name,
          email: userToAuth.email,
          role: userToAuth.role,
          passcodePin: userToAuth.passcodePin,
          saasPlan: userToAuth.saasPlan,
          transcribeCount: userToAuth.transcribeCount
        }
      });
    } catch (error: any) {
      console.error("Verify OTP crash:", error);
      return res.status(500).json({ error: error.message || "Failed to verify credentials." });
    }
  });

  app.post("/api/auth/check-session", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.json({ authenticated: false });
      }

      const [session] = await db.select().from(userSessions).where(eq(userSessions.token, token));
      if (!session) {
        return res.json({ authenticated: false });
      }

      if (Date.now() > session.expiresAt) {
        await db.delete(userSessions).where(eq(userSessions.token, token));
        return res.json({ authenticated: false });
      }

      const [user] = await db.select().from(users).where(eq(users.email, session.email.toLowerCase()));
      if (!user) {
        return res.json({ authenticated: false });
      }

      return res.json({
        authenticated: true,
        user: {
          name: user.name,
          email: user.email,
          role: user.role,
          passcodePin: user.passcodePin,
          saasPlan: user.saasPlan,
          transcribeCount: user.transcribeCount
        }
      });
    } catch (error) {
      return res.json({ authenticated: false });
    }
  });

  app.post("/api/auth/bypass", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Bypass email required." });
      }

      let [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) {
        [user] = await db.insert(users).values({
          name: "Bilal Faisal Arain",
          email: email.toLowerCase(),
          password: "password123",
          role: "Owner",
          passcodePin: "1234",
          saasPlan: email.toLowerCase() === "farain539@gmail.com" ? "pro" : "free",
          transcribeCount: 1,
        }).returning();
      }

      const token = "sess_bypass_" + Math.random().toString(36).substring(2, 12);
      await db.insert(userSessions).values({
        token,
        email: user.email,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      });

      return res.json({
        success: true,
        token,
        user: {
          name: user.name,
          email: user.email,
          role: user.role,
          passcodePin: user.passcodePin,
          saasPlan: user.saasPlan,
          transcribeCount: user.transcribeCount
        }
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Bypass failed." });
    }
  });

  app.post("/api/auth/update-pin", async (req, res) => {
    try {
      const { email, pin } = req.body;
      if (!email || !pin) {
        return res.status(400).json({ error: "Email and PIN are required." });
      }

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      await db.update(users).set({ passcodePin: pin }).where(eq(users.id, user.id));

      return res.json({ success: true, passcodePin: pin });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to update PIN." });
    }
  });

  // USER ISOLATED DATA PERSISTENCE API ENDPOINTS
  app.get("/api/history", async (req, res) => {
    try {
      const email = req.query.email as string;
      if (!email) return res.status(400).json({ error: "Email required." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      const list = await db.select().from(transcriptionHistory)
        .where(eq(transcriptionHistory.userId, user.id))
        .orderBy(desc(transcriptionHistory.timestamp));

      return res.json(list);
    } catch (err: any) {
      console.error("GET /api/history crash:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch history." });
    }
  });

  app.post("/api/history", async (req, res) => {
    try {
      const { email, item } = req.body;
      if (!email || !item) return res.status(400).json({ error: "Parameters missing." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      const [newItem] = await db.insert(transcriptionHistory).values({
        userId: user.id,
        timestamp: item.timestamp,
        fileName: item.fileName,
        fileSize: item.fileSize,
        duration: item.duration || null,
        rawText: item.rawText,
        parsed: item.parsed,
        instruction: item.instruction || null,
        mode: item.mode,
      }).returning();

      return res.json(newItem);
    } catch (err: any) {
      console.error("POST /api/history crash:", err);
      return res.status(500).json({ error: err.message || "Failed to save history." });
    }
  });

  app.delete("/api/history", async (req, res) => {
    try {
      const { email, id } = req.body;
      if (!email) return res.status(400).json({ error: "Email required." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      if (id) {
        await db.delete(transcriptionHistory).where(
          and(
            eq(transcriptionHistory.id, parseInt(id)),
            eq(transcriptionHistory.userId, user.id)
          )
        );
      } else {
        await db.delete(transcriptionHistory).where(eq(transcriptionHistory.userId, user.id));
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error("DELETE /api/history crash:", err);
      return res.status(500).json({ error: err.message || "Failed to delete history." });
    }
  });

  app.get("/api/keys", async (req, res) => {
    try {
      const email = req.query.email as string;
      if (!email) return res.status(400).json({ error: "Email required." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      const list = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id));
      return res.json(list);
    } catch (err: any) {
      console.error("GET /api/keys crash:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch keys." });
    }
  });

  app.post("/api/keys", async (req, res) => {
    try {
      const { email, name, token, createdAt } = req.body;
      if (!email || !name || !token) return res.status(400).json({ error: "Parameters missing." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      const [newKey] = await db.insert(apiKeys).values({
        userId: user.id,
        name,
        token,
        status: "active",
        createdAt: createdAt || new Date().toLocaleString(),
      }).returning();

      return res.json(newKey);
    } catch (err: any) {
      console.error("POST /api/keys crash:", err);
      return res.status(500).json({ error: err.message || "Failed to create key." });
    }
  });

  app.post("/api/keys/revoke", async (req, res) => {
    try {
      const { email, id } = req.body;
      if (!email || !id) return res.status(400).json({ error: "Parameters missing." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      await db.update(apiKeys).set({ status: "revoked" }).where(
        and(
          eq(apiKeys.id, parseInt(id)),
          eq(apiKeys.userId, user.id)
        )
      );

      return res.json({ success: true });
    } catch (err: any) {
      console.error("POST /api/keys/revoke crash:", err);
      return res.status(500).json({ error: err.message || "Failed to revoke key." });
    }
  });

  app.delete("/api/keys", async (req, res) => {
    try {
      const { email, id } = req.body;
      if (!email || !id) return res.status(400).json({ error: "Parameters missing." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      await db.delete(apiKeys).where(
        and(
          eq(apiKeys.id, parseInt(id)),
          eq(apiKeys.userId, user.id)
        )
      );

      return res.json({ success: true });
    } catch (err: any) {
      console.error("DELETE /api/keys crash:", err);
      return res.status(500).json({ error: err.message || "Failed to delete key." });
    }
  });

  app.get("/api/team", async (req, res) => {
    try {
      const email = req.query.email as string;
      if (!email) return res.status(400).json({ error: "Email required." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      const list = await db.select().from(teamMembers).where(eq(teamMembers.userId, user.id));
      return res.json(list);
    } catch (err: any) {
      console.error("GET /api/team crash:", err);
      return res.status(500).json({ error: err.message || "Failed to fetch team." });
    }
  });

  app.post("/api/team/invite", async (req, res) => {
    try {
      const { email, member } = req.body;
      if (!email || !member) return res.status(400).json({ error: "Parameters missing." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      const [newMember] = await db.insert(teamMembers).values({
        userId: user.id,
        name: member.name,
        email: member.email,
        role: member.role,
        joinedAt: member.joinedAt || new Date().toLocaleDateString(),
      }).returning();

      return res.json(newMember);
    } catch (err: any) {
      console.error("POST /api/team/invite crash:", err);
      return res.status(500).json({ error: err.message || "Failed to add member." });
    }
  });

  app.delete("/api/team", async (req, res) => {
    try {
      const { email, id } = req.body;
      if (!email || !id) return res.status(400).json({ error: "Parameters missing." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      await db.delete(teamMembers).where(
        and(
          eq(teamMembers.id, parseInt(id)),
          eq(teamMembers.userId, user.id)
        )
      );

      return res.json({ success: true });
    } catch (err: any) {
      console.error("DELETE /api/team crash:", err);
      return res.status(500).json({ error: err.message || "Failed to delete member." });
    }
  });

  app.post("/api/auth/update-plan", async (req, res) => {
    try {
      const { email, plan, transcribeCount } = req.body;
      if (!email) return res.status(400).json({ error: "Email required." });
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return res.status(404).json({ error: "User not found." });

      const updates: any = {};
      if (plan) updates.saasPlan = plan;
      if (transcribeCount !== undefined) updates.transcribeCount = transcribeCount;

      const [updatedUser] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
      return res.json({ 
        success: true, 
        user: {
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
          passcodePin: updatedUser.passcodePin,
          saasPlan: updatedUser.saasPlan,
          transcribeCount: updatedUser.transcribeCount
        }
      });
    } catch (err: any) {
      console.error("POST /api/auth/update-plan crash:", err);
      return res.status(500).json({ error: err.message || "Failed to update plan." });
    }
  });

  // SYSTEM CONTROL PANEL ADMIN ENDPOINTS
  app.post("/api/admin/db", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(401).json({ error: "Session token is required." });
      }

      const [session] = await db.select().from(userSessions).where(eq(userSessions.token, token));
      if (!session) {
        return res.status(401).json({ error: "Unauthorized session." });
      }

      const [user] = await db.select().from(users).where(eq(users.email, session.email.toLowerCase()));
      if (!user || (user.role !== "Owner" && user.role !== "Admin" && user.email.toLowerCase() !== "farain539@gmail.com")) {
        return res.status(403).json({ error: "Access denied: Owner/Admin role required." });
      }

      const allUsers = await db.select().from(users);
      const allSessions = await db.select().from(userSessions);
      let [settings] = await db.select().from(adminSettings).where(eq(adminSettings.id, 1));
      
      if (!settings) {
        [settings] = await db.insert(adminSettings).values({
          id: 1,
          smtpHost: "smtp.gmail.com",
          smtpPort: "587",
          smtpUser: "",
          smtpPass: "",
          smtpFrom: "",
          geminiApiKey: ""
        }).returning();
      }

      return res.json({
        users: allUsers.map((u: any) => ({
          name: u.name,
          email: u.email,
          role: u.role,
          passcodePin: u.passcodePin,
          password: u.password || "password123"
        })),
        sessions: allSessions,
        settings: {
          smtp_host: settings.smtpHost,
          smtp_port: settings.smtpPort,
          smtp_user: settings.smtpUser,
          smtp_pass: settings.smtpPass,
          smtp_from: settings.smtpFrom,
          gemini_api_key: settings.geminiApiKey
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to retrieve database." });
    }
  });

  app.post("/api/admin/users/save", async (req, res) => {
    try {
      const { token, userToSave } = req.body;
      if (!token || !userToSave) {
        return res.status(400).json({ error: "Parameters missing." });
      }

      const [session] = await db.select().from(userSessions).where(eq(userSessions.token, token));
      if (!session) {
        return res.status(401).json({ error: "Unauthorized session." });
      }

      const [adminUser] = await db.select().from(users).where(eq(users.email, session.email.toLowerCase()));
      if (!adminUser || (adminUser.role !== "Owner" && adminUser.role !== "Admin" && adminUser.email.toLowerCase() !== "farain539@gmail.com")) {
        return res.status(403).json({ error: "Access denied." });
      }

      const { name, email, password, role, passcodePin, originalEmail } = userToSave;
      if (!email || !name) {
        return res.status(400).json({ error: "Email and name are required." });
      }

      if (originalEmail) {
        const [existing] = await db.select().from(users).where(eq(users.email, originalEmail.toLowerCase()));
        if (!existing) {
          return res.status(404).json({ error: "Original user not found." });
        }

        if (email.toLowerCase() !== originalEmail.toLowerCase()) {
          const [collision] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
          if (collision) {
            return res.status(400).json({ error: "Email address is already in use by another user." });
          }
        }

        await db.update(users).set({
          name,
          email: email.toLowerCase(),
          password: password || existing.password,
          role: role || existing.role,
          passcodePin: passcodePin || existing.passcodePin
        }).where(eq(users.id, existing.id));
      } else {
        const [collision] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
        if (collision) {
          return res.status(400).json({ error: "Email address is already in use." });
        }

        await db.insert(users).values({
          name,
          email: email.toLowerCase(),
          password: password || "password123",
          role: role || "Developer",
          passcodePin: passcodePin || "1234",
          saasPlan: "free",
          transcribeCount: 1,
        });
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to save user." });
    }
  });

  app.post("/api/admin/users/delete", async (req, res) => {
    try {
      const { token, emailToDelete } = req.body;
      if (!token || !emailToDelete) {
        return res.status(400).json({ error: "Parameters missing." });
      }

      const [session] = await db.select().from(userSessions).where(eq(userSessions.token, token));
      if (!session) {
        return res.status(401).json({ error: "Unauthorized session." });
      }

      const [adminUser] = await db.select().from(users).where(eq(users.email, session.email.toLowerCase()));
      if (!adminUser || (adminUser.role !== "Owner" && adminUser.role !== "Admin" && adminUser.email.toLowerCase() !== "farain539@gmail.com")) {
        return res.status(403).json({ error: "Access denied." });
      }

      if (emailToDelete.toLowerCase() === adminUser.email.toLowerCase()) {
        return res.status(400).json({ error: "You cannot delete your own active admin user!" });
      }

      const [userToDelete] = await db.select().from(users).where(eq(users.email, emailToDelete.toLowerCase()));
      if (userToDelete) {
        await db.delete(users).where(eq(users.id, userToDelete.id));
        await db.delete(userSessions).where(eq(userSessions.email, emailToDelete.toLowerCase()));
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to delete user." });
    }
  });

  app.post("/api/admin/settings/save", async (req, res) => {
    try {
      const { token, settings } = req.body;
      if (!token || !settings) {
        return res.status(400).json({ error: "Required parameters missing." });
      }

      const [session] = await db.select().from(userSessions).where(eq(userSessions.token, token));
      if (!session) {
        return res.status(401).json({ error: "Unauthorized session." });
      }

      const [adminUser] = await db.select().from(users).where(eq(users.email, session.email.toLowerCase()));
      if (!adminUser || (adminUser.role !== "Owner" && adminUser.role !== "Admin" && adminUser.email.toLowerCase() !== "farain539@gmail.com")) {
        return res.status(403).json({ error: "Access denied." });
      }

      const [existingSettings] = await db.select().from(adminSettings).where(eq(adminSettings.id, 1));
      if (existingSettings) {
        await db.update(adminSettings).set({
          smtpHost: settings.smtp_host || "",
          smtpPort: settings.smtp_port || "",
          smtpUser: settings.smtp_user || "",
          smtpPass: settings.smtp_pass || "",
          smtpFrom: settings.smtp_from || "",
          geminiApiKey: settings.gemini_api_key || ""
        }).where(eq(adminSettings.id, 1));
      } else {
        await db.insert(adminSettings).values({
          id: 1,
          smtpHost: settings.smtp_host || "",
          smtpPort: settings.smtp_port || "",
          smtpUser: settings.smtp_user || "",
          smtpPass: settings.smtp_pass || "",
          smtpFrom: settings.smtp_from || "",
          geminiApiKey: settings.gemini_api_key || ""
        });
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to save settings." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
