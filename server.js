import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { GoogleGenAI } from "@google/genai";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = 3001;

app.use(helmet({
  contentSecurityPolicy: false, // Desabilitando CSP estrito para evitar bloqueios de CDN/Scripts
}));
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

const server = app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
server.setTimeout(300000); // 5 minutos timeout

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Muitas requisições. Aguarde.'
});
app.use(limiter);

if (!process.env.API_KEY) console.error("⚠️ Falta API_KEY (Gemini)");
if (!process.env.FIRECRAWL_API_KEY) console.error("⚠️ Falta FIRECRAWL_API_KEY");
if (!process.env.SERPER_API_KEY) console.error("⚠️ Falta SERPER_API_KEY");

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper para timeout em Promises
const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Timeout Interno IA')), ms);
  });
  return Promise.race([
    promise.then(res => { clearTimeout(timeoutId); return res; }),
    timeoutPromise
  ]);
};

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      hasGemini: !!process.env.API_KEY,
      hasSerper: !!process.env.SERPER_API_KEY,
      hasFirecrawl: !!process.env.FIRECRAWL_API_KEY
    }
  });
});

app.post('/api/search-source', async (req, res) => {
  const { url, sourceName, mode = 'scrape' } = req.body;

  if (!url || !sourceName) {
    return res.status(400).json({ error: 'URL/Query e SourceName são obrigatórios.' });
  }

  console.log(`🚀 Processando ${sourceName} [Modo: ${mode}]`);

  try {
    let contentToAnalyze = "";

    // --- MODO 1: GOOGLE SEARCH (SERPER) ---
    if (mode === 'search') {
      if (!process.env.SERPER_API_KEY) return res.json({ events: [], warning: "Sem chave Serper" });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s máx para Serper

      try {
        const serperResp = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": process.env.SERPER_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            q: url,
            location: "Campinas, Sao Paulo, Brazil",
            gl: "br",
            hl: "pt-br",
            num: 20,
            tbs: "qdr:m"
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!serperResp.ok) throw new Error(`Serper Error: ${serperResp.status}`);
        const serperJson = await serperResp.json();
        contentToAnalyze = JSON.stringify(serperJson.organic || [], null, 2);

      } catch (err) {
        clearTimeout(timeoutId);
        console.warn(`⚠️ Serper falhou: ${err.message}`);
        return res.json({ events: [], warning: "Timeout busca." });
      }
    }
    // --- MODO 2: SCRAPE (FIRECRAWL) ---
    else {
      // Timeout Firecrawl: 20s (ainda mais curto para não travar fila)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      try {
        const firecrawlResp = await fetch('https://api.firecrawl.dev/v2/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: url,
            formats: ['markdown'],
            onlyMainContent: true
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!firecrawlResp.ok) throw new Error(`Status ${firecrawlResp.status}`);
        const firecrawlData = await firecrawlResp.json();
        contentToAnalyze = firecrawlData.data?.markdown || "";

      } catch (err) {
        clearTimeout(timeoutId);
        console.warn(`⏱️ Firecrawl falhou (${sourceName}): ${err.message}`);
        return res.json({ events: [], warning: "Timeout site." });
      }
    }

    if (!contentToAnalyze || contentToAnalyze.length < 50) {
      return res.json({ events: [], warning: "Conteúdo vazio" });
    }

    // --- GEMINI ---
    const todayStr = new Date().toLocaleDateString('pt-BR');
    // Limita contexto para 25k chars para resposta rápida
    const limitedContent = contentToAnalyze.substring(0, 25000);

    const prompt = `
      Contexto: Extração de Eventos B2B em Campinas/SP.
      Hoje: ${todayStr}.
      Fonte: ${sourceName} (${mode}).
      
      Extraia eventos futuros de NEGÓCIOS (Palestras, Workshops, Networking).
      Ignore shows/lazer.
      
      JSON Saída: [{ "title": "...", "date": "DD/MM", "location": "...", "link": "...", "analysis": "...", "opportunity": "..." }]
      
      Texto:
      ${limitedContent}
    `;

    // Timeout na IA de 25 segundos
    const aiPromise = ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const aiResp = await withTimeout(aiPromise, 25000);

    const cleanText = aiResp.text?.replace(/```json/g, '').replace(/```/g, '').trim();
    const events = JSON.parse(cleanText || "[]");

    console.log(`✅ ${sourceName}: ${events.length} eventos.`);
    res.json({ events });

  } catch (error) {
    console.error(`Erro geral em ${sourceName}:`, error.message);
    res.json({ events: [], error: error.message });
  }
});

// Catch-all para SPA (React)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});