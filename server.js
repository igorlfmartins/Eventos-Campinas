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
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = ['http://localhost:5173', 'https://eventos-b2b-campinas.up.railway.app'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Bloqueado por CORS: ${origin}`);
      callback(null, false); // Não gera erro 500, apenas bloqueia
    }
  }
}));
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

// Mapeamento flexível para aceitar os nomes que o usuário configurou no Railway
const GEMINI_KEY = process.env.API_KEY || process.env.GEMINI_API_KEY;
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY || process.env.VITE_FIRECRAWL_API_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY || process.env.VITE_SERPER_API_KEY;

if (!GEMINI_KEY) console.error("⚠️ Falta API_KEY / GEMINI_API_KEY");
if (!FIRECRAWL_KEY) console.error("⚠️ Falta FIRECRAWL_API_KEY / VITE_FIRECRAWL_API_KEY");
if (!SERPER_KEY) console.error("⚠️ Falta SERPER_API_KEY / VITE_SERPER_API_KEY");

const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

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
      hasGemini: !!GEMINI_KEY,
      hasSerper: !!SERPER_KEY,
      hasFirecrawl: !!FIRECRAWL_KEY
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
      if (!SERPER_KEY) return res.json({ events: [], warning: "Sem chave Serper" });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s máx para Serper

      try {
        const serperResp = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": SERPER_KEY,
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
      // Timeout Firecrawl: 90s (ainda mais curto para não travar fila)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      try {
        const firecrawlResp = await fetch('https://api.firecrawl.dev/v2/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_KEY}`,
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

    // Log para debug
    console.log(`📄 ${sourceName}: Conteúdo recebido com ${contentToAnalyze.length} caracteres.`);

    if (!contentToAnalyze || contentToAnalyze.length < 50) {
      return res.json({ events: [], warning: "Conteúdo vazio ou insuficiente." });
    }

    // --- GEMINI ---
    const todayStr = new Date().toLocaleDateString('pt-BR');
    // Limita contexto para 25k chars para resposta rápida
    const limitedContent = contentToAnalyze.substring(0, 25000);

    const prompt = `
      Contexto: Sou um corretor de seguros focado em prospecção de leads qualificados (Seguros Empresariais, Saúde, Vida e Patrimonial) em Campinas/SP.
      Hoje: ${todayStr} (dia/mês/ano).
      Fonte: ${sourceName} (${mode}).
      
      OBJETIVO: Extrair APENAS eventos FUTUROS que sejam oportunidades para encontrar DECISORES (Donos de empresas, RHs, Gestores) ou pessoas com alto potencial para seguros.
      IMPORTANTE: Se for notícia, tente achar o link DA INSCRIÇÃO/DETALHES, não apenas a notícia.

      REGRAS DE CONTEÚDO:
      1. PRIORIDADE: Eventos de RH, Gestão de Gessoas, Tecnologia, Direito, Indústrias, Agronegócio, Networking de Empresários.
      2. ANALISE: Por que esse evento é uma boa para um corretor de seguros? (Ex: "Muitos donos de indústria estarão lá", "Debate sobre saúde mental no trabalho atrai RHs").
      3. SE JÁ PASSOU (${todayStr}), DESCARTE.

      JSON Saída:
      {
        "events": [{ 
          "title": "Titulo Claro", 
          "date": "dd/mm/yyyy", 
          "location": "Local", 
          "link": "URL direta", 
          "analysis": "Breve contexto do evento", 
          "opportunity": "Networking / Leads / Parceria",
          "insurance_relevance": "Explicação curta do PORQUÊ é bom para vender seguros"
        }],
        "debug_summary": "Encontrados X eventos futuros..."
      }
      
      Texto para análise:
      ${limitedContent}
    `;

    // Timeout na IA de 25 segundos
    const aiPromise = ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: limitedContent, // Simplificando para passar o conteúdo direto como prompt
      config: {
        responseMimeType: 'application/json',
        systemInstruction: prompt.substring(0, prompt.indexOf('Texto para análise:')) // Passando as instruções como sistema se possível, ou apenas unindo
      }
    });

    const aiResp = await withTimeout(aiPromise, 60000);

    const cleanText = aiResp.text?.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanText || '{ "events": [], "debug_summary": "Erro no parse" }');

    // Tratamento para caso a IA devolva array direto ou objeto
    let events = Array.isArray(result) ? result : (result.events || []);
    const debugInfo = result.debug_summary || "Sem info";

    // Mapeia o campo snake_case do JSON para o camelCase do TypeScript
    events = events.map(e => ({
      ...e,
      insuranceRelevance: e.insurance_relevance || e.insuranceRelevance || "Sem explicação específica."
    }));

    console.log(`✅ ${sourceName}: ${events.length} eventos. Debug: ${debugInfo}`);
    res.json({ events, debug: debugInfo });

  } catch (error) {
    console.error(`Erro geral em ${sourceName}:`, error.message);
    res.json({ events: [], error: error.message });
  }
});

// Catch-all para SPA (React)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});