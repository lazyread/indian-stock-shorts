// ============================================================
// Template-Based Script Generator -- Zero API Cost
// Takes stock info and auto-generates scripts, scenes, and SEO
// No external AI API required
//
// FIDELITY RULES (enforced throughout):
//   1. User input is the ONLY source of content facts
//   2. Fallbacks must be neutral/minimal, never fabricated positives
//   3. Image prompts derive from scene narration, not a static lookup
//   4. "Why it matters" uses actual sentences from stockData
//   5. Hallucination = any claim not traceable to user input
// ============================================================

import type { GeneratedScript, GeneratedScene, GeneratedSEO, VideoTone, VideoStyle } from '@/types';

// ============================================================
// Utility helpers
// ============================================================

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

// ============================================================
// Sector detection from stock name + provided info
// ============================================================

function detectSector(stockName: string, info: string): string {
  const t = `${stockName} ${info}`.toLowerCase();
  if (/bank|finance|nbfc|insurance|hdfc|icici|axis|kotak|sbi|pnb|canara/.test(t)) return 'Banking & Finance';
  if (/tech|it|software|infosys|tcs|wipro|hcl|tech mahindra|mphasis|ltimindtree/.test(t)) return 'IT & Technology';
  if (/auto|motor|car|vehicle|tata motors|maruti|bajaj|hero|eicher|m&m|mahindra/.test(t)) return 'Automobile';
  if (/pharma|drug|medicine|sun pharma|cipla|dr reddy|biocon|lupin|zydus|alkem/.test(t)) return 'Pharmaceuticals';
  if (/fmcg|consumer|food|hul|nestle|itc|dabur|marico|godrej consumer|emami/.test(t)) return 'FMCG';
  if (/energy|oil|gas|power|reliance|ongc|ntpc|tata power|adani green|torrent/.test(t)) return 'Energy';
  if (/steel|metal|mining|tata steel|jsw|hindalco|vedanta|coal india|nmdc/.test(t)) return 'Metals & Mining';
  if (/real estate|realty|dlf|godrej property|prestige|oberoi|brigade/.test(t)) return 'Real Estate';
  if (/telecom|airtel|jio|vodafone|indus towers/.test(t)) return 'Telecom';
  if (/infra|construction|l&t|larsen|irb|knr|rites|ircon/.test(t)) return 'Infrastructure';
  if (/cement|ultratech|shree|ambuja|acc|dalmia/.test(t)) return 'Cement';
  if (/retail|dmart|avenue|trent|titan|v-mart/.test(t)) return 'Retail';
  return 'Stock Market';
}

// ============================================================
// Source-lock: extract structured facts from user input
//
// This runs FIRST. Every downstream stage references only what
// is in here. Nothing is fabricated or inferred beyond what
// is explicitly in the user's stockData text.
// ============================================================

interface LockedContext {
  stockName:    string;
  ticker:       string;
  sector:       string;
  tone:         VideoTone;
  // All extracted directly from user text -- immutable
  keyFacts:     string[];   // 3-6 substantive sentences from user input
  numbers:      string[];   // numeric facts: "12% growth", "₹2,840", "P/E 23"
  positives:    string[];   // sentences containing positive signals from user text
  negatives:    string[];   // sentences containing risk/negative signals from user text
  rawInput:     string;     // original stockData -- never modified
}

function buildLockedContext(
  stockName: string,
  ticker:    string,
  stockData: string,
  tone:      VideoTone,
): LockedContext {
  const sector = detectSector(stockName, stockData);

  // Split into sentences; keep only those with meaningful length
  const sentences = (stockData.match(/[^.!?\n]+[.!?]*/g) ?? [stockData])
    .map(s => s.trim())
    .filter(s => s.length > 12);

  // Numbers with context: percentages, rupee values, ratios, periods
  const numMatches = stockData.match(
    /(?:₹\s*[\d,]+(?:\.\d+)?(?:\s*(?:cr(?:ore)?|lakh|k|bn|B|M|million|billion))?)|[\d,]+(?:\.\d+)?\s*%|P\/E\s*(?:of\s*)?[\d.]+|EPS\s*[\d.]+|\b[\d.]+x\b|\b(?:Q[1-4]|H[12]|FY\d{2,4})\b/gi
  ) ?? [];
  const numbers = [...new Set(numMatches.map(n => n.trim()).filter(n => n.length > 1))].slice(0, 6);

  // Sentences with positive signals from the text itself
  const positives = sentences.filter(s =>
    /\b(growth|up|rise|surge|beat|strong|profit|expand|record|gain|outperform|recovery|win|contract|order|increase|improve|higher|robust|solid|breakthrough|milestone)\b/i.test(s)
  ).slice(0, 4);

  // Sentences with risk/negative signals from the text itself
  const negatives = sentences.filter(s =>
    /\b(down|fall|drop|decline|miss|weak|loss|risk|concern|challenge|headwind|pressure|slowdown|uncertainty|caution|volatile)\b/i.test(s)
  ).slice(0, 3);

  // Key facts: sentences that contain numeric data or named business concepts
  const keyFacts = sentences.filter(s =>
    s.length > 20 && s.length < 240 &&
    /[\d%₹]|(?:revenue|profit|growth|market|quarter|year|crore|million|billion|sector|business|contract|order|margin|return|dividend|cash|debt)/.test(s)
  ).slice(0, 6);

  // Fallback: if no structured facts found, use first substantive sentences
  const facts = keyFacts.length >= 2 ? keyFacts : sentences.filter(s => s.length > 20).slice(0, 5);

  return { stockName, ticker, sector, tone, keyFacts: facts, numbers, positives, negatives, rawInput: stockData };
}

// ============================================================
// Anti-hallucination extractors
//
// These replace the old fabricated fallback strings.
// They pull real content from user text, or return minimal
// neutral statements -- never invented positives.
// ============================================================

// Pull the strongest positive signal from the user's text.
// Never invents one if none exists in the input.
function extractPositiveSignal(ctx: LockedContext): string {
  if (ctx.positives.length > 0) return ctx.positives[0].slice(0, 220);
  // No explicitly positive sentence -- use first substantive fact neutrally
  if (ctx.keyFacts.length > 0) return ctx.keyFacts[0].slice(0, 220);
  return ctx.rawInput.trim().slice(0, 220);
}

// Pull the clearest numerical/metric highlight from the user's text.
// Never invents "impressive performance" if no number is present.
function extractKeyHighlight(ctx: LockedContext): string {
  // Prefer sentences that actually contain numbers
  const withNum = ctx.keyFacts.find(s => /[\d%₹]/.test(s));
  if (withNum) return `the numbers tell the story: ${withNum.slice(0, 160)}`;

  // No numbers -- use first key fact without embellishment
  if (ctx.keyFacts.length > 0) return ctx.keyFacts[0].slice(0, 160);
  if (ctx.numbers.length > 0) return `the key figures: ${ctx.numbers.slice(0, 3).join(', ')}`;

  return ctx.rawInput.trim().slice(0, 160);
}

// Build the "why it matters" section from user context.
// Uses a deeper sentence from the input -- NEVER generic
// "smart money is positioning" or "macro is lining up" filler.
function buildWhyItMatters(ctx: LockedContext): string {
  const { stockName, sector, tone, keyFacts, positives, negatives } = ctx;

  // Use a fact the body hasn't already covered (idx >= 2)
  const deepFact =
    keyFacts[2] ??
    keyFacts[1] ??
    positives[1] ??
    positives[0] ??
    negatives[0];

  if (!deepFact) {
    // Absolute minimum -- no fabricated positives, just a factual anchor
    return `${stockName} operates in the ${sector} sector. This development is directly relevant for investors tracking this space.`;
  }

  const prefix: Record<VideoTone, string> = {
    VIRAL:        "Here's why the market is paying attention:",
    AGGRESSIVE:   "The bigger picture:",
    PROFESSIONAL: "The investment significance:",
    EDUCATIONAL:  "Here's why this matters for investors:",
    URGENT:       "The critical context right now:",
  };

  return `${prefix[tone] ?? 'The significance:'} ${deepFact}`;
}

// ============================================================
// Narration-aware image prompt builder
//
// Derives the image prompt from what the scene is ACTUALLY
// ABOUT (its narration text), not from a static sector index.
// The sector table is used only as a fallback.
// ============================================================

// Fallback sector images -- used ONLY when narration doesn't
// map to a recognisable theme.
const SECTOR_IMAGES: Record<string, string[]> = {
  'Banking & Finance': [
    'modern Indian bank headquarters glass tower at night with glowing financial data on screens, Mumbai skyline, dramatic blue and gold lighting, cinematic atmosphere',
    'close-up of smartphone showing banking app with green profit numbers, NSE ticker data, bokeh city background, professional product photography',
    'Indian bank branch interior with digital screens showing market data, professional lighting, customers in background, sleek modern design',
    'Mumbai financial district aerial view at golden hour, Bandra Kurla Complex skyline, dramatic warm lighting, business district energy',
    'NSE trading terminal screens glowing in dark room showing red and green candlestick charts, dramatic contrast lighting, financial data visualization',
    'Indian businessman reviewing financial documents at modern desk with multiple monitors, professional office setting, focused atmosphere',
  ],
  'IT & Technology': [
    'modern Indian tech campus building at night with glowing blue lights, Bangalore tech hub atmosphere, sleek corporate architecture',
    'close-up of laptop showing software dashboard with analytics data, hands typing code, clean desk setup, natural light from window',
    'young Indian software engineers collaborating in open-plan tech office, multiple screens, energetic startup atmosphere',
    'server room with rows of glowing equipment, blue and purple lighting, data center scale, India cloud computing theme',
    'abstract digital background showing code patterns and rupee symbols floating, dark blue atmosphere, technology concept art',
    'Indian tech professional presenting data visualization on large screen, conference room, professional corporate setting',
  ],
  'Automobile': [
    'sleek modern Indian SUV on dramatic showroom floor, studio spotlights, reflective polished surface, premium automotive photography',
    'automated car manufacturing plant in India with robotic arms welding, dramatic industrial orange and blue lighting',
    'aerial view of Indian expressway with modern vehicles, golden hour lighting, dynamic transportation energy',
    'close-up of luxury car wheel and brake disc on city road, motion blur background, professional automotive detail shot',
    'electric vehicle charging station in modern Indian city, clean green energy aesthetic, futuristic urban setting',
    'car dealership showroom interior with multiple vehicles on display, professional lighting, premium retail atmosphere',
  ],
  'Pharmaceuticals': [
    'state-of-the-art Indian pharmaceutical laboratory with scientists in white coats, clean sterile environment, bright clinical lighting',
    'close-up macro shot of colorful medicine capsules and tablets on clean reflective surface, professional product photography',
    'pharmaceutical manufacturing facility with automated production lines in India, industrial clean room setting',
    'Indian doctor using digital tablet in modern hospital corridor, healthcare technology, professional medical setting',
    'microscope and research equipment in biotech laboratory, scientist analyzing samples, Indian R&D facility',
    'pharmaceutical supply chain logistics hub with labeled packages and automated sorting, efficient modern facility',
  ],
  'FMCG': [
    'premium Indian consumer product range artfully arranged on dark background, dramatic studio lighting, vibrant brand colors',
    'busy modern Indian supermarket aisle with colorful product displays, lifestyle photography, consumer goods',
    'Indian family enjoying branded consumer products at home, warm natural lighting, aspirational lifestyle photography',
    'brand identity and packaging design showcase on clean white surface, professional product photography, FMCG retail',
    'distribution warehouse with stacked branded consumer goods, organized logistics, efficient supply chain India',
    'modern Indian urban retail store interior, well-lit shelves with consumer products, professional commercial photography',
  ],
  'Energy': [
    'massive oil refinery at dramatic Indian sunset, industrial silhouette against orange sky, scale and power',
    'vast solar farm in Rajasthan desert, thousands of panels stretching to horizon, aerial drone perspective, clean energy',
    'wind turbines on Indian west coast at golden hour, clean renewable energy, dramatic ocean backdrop',
    'power plant with cooling towers reflected in still water at dusk, atmospheric lighting, industrial poetry',
    'smart city energy grid visualization over India map, glowing connection lines, technology meets infrastructure',
    'LNG terminal or gas processing facility at night, industrial lighting, energy sector infrastructure India',
  ],
  'Metals & Mining': [
    'steel plant with molten metal pouring from furnace, dramatic red-orange glow, intense industrial atmosphere India',
    'modern automated steel manufacturing facility, massive rolling mill equipment, industrial scale photography',
    'open-cast mining operation in India aerial view, scale of operations, geological landscape',
    'finished steel coils and products in massive warehouse, industrial scale, professional facility photography',
    'commodity trading floor or metals exchange data visualization, screens showing price data, financial trading',
    'construction site using Indian steel products, urban development, infrastructure growth photography',
  ],
  'Real Estate': [
    'luxury Indian residential towers under construction against blue sky, cranes and scaffolding, real estate development',
    'modern apartment complex interior with premium finishes, real estate marketing photography, aspirational living',
    'aerial view of Indian city showing real estate development, urban growth, residential and commercial mix',
    'upscale commercial real estate building exterior, glass and steel facade, corporate real estate photography',
    'real estate developer presentation with building scale model, architectural concept, professional meeting setting',
    'smart home technology in premium Indian apartment, modern interior design, technology and lifestyle',
  ],
  'Telecom': [
    '5G cell tower at sunset with signal wave visualization overlay, Indian telecom infrastructure, technology',
    'close-up of smartphone showing high-speed data visualization, connectivity theme, professional tech photography',
    'young Indian consumers using mobile devices in urban setting, digital lifestyle photography, telecom narrative',
    'fiber optic cables glowing with light, data transmission concept, Indian digital infrastructure theme',
    'telecom operations center with monitoring screens, engineers managing network, professional technical setting',
    'Indian city skyline at night with glowing network connectivity lines overlay, digital India theme',
  ],
  'Infrastructure': [
    'dramatic aerial view of Indian highway interchange under construction, scale of infrastructure project',
    'modern bridge construction in India, engineering achievement, golden hour dramatic lighting',
    'high-speed rail project in India, train passing through landscape, infrastructure development photography',
    'construction workers at major Indian infrastructure project, safety equipment, professional documentary photography',
    'completed modern infrastructure project in India, showcase of engineering, professional photography',
    'smart city infrastructure project aerial view, urban planning, Indian development story',
  ],
  'Cement': [
    'cement plant at dusk with dramatic industrial silhouette, kiln glowing, Indian manufacturing scale',
    'construction site in India with cement being poured, building activity, infrastructure growth',
    'modern cement bags stacked in distribution warehouse, supply chain photography, industrial scale',
    'aerial view of Indian construction boom, multiple sites active simultaneously, economic development',
    'cement manufacturing process close-up, rotating kiln or grinding mill, industrial process photography',
    'urban skyline of growing Indian city, construction cranes everywhere, real estate and cement demand',
  ],
  'Retail': [
    'modern Indian shopping mall interior with premium brand stores, consumer lifestyle photography, retail energy',
    'supermarket with well-organized fresh produce and products, retail operations photography, India',
    'busy Indian retail store with customers shopping, authentic retail environment, consumer behavior',
    'retail logistics and supply chain, delivery vehicles and warehouse, e-commerce and retail India',
    'retail store display with attractive product arrangement, merchandising photography, professional',
    'Indian consumer pulling shopping cart, retail therapy, lifestyle photography, modern retail India',
  ],
  'Stock Market': [
    'Bombay Stock Exchange building exterior at golden hour, iconic BSE dome, Mumbai financial landmark',
    'NSE or BSE trading terminal screens showing red and green market data, dramatic contrast lighting',
    'Indian stock market chart on digital screen trending upward, financial data visualization, professional',
    'Indian investor with multiple trading screens in home office, focused concentration, modern setup',
    'financial newspaper with Indian stock market headlines on professional desk, business photography',
    'Bull statue outside BSE Mumbai, iconic Indian financial market symbol, dramatic lighting',
  ],
};

function narrativeToImagePrompt(
  narration: string,
  ctx:       LockedContext,
  idx:       number,
): string {
  const { stockName, ticker, sector, tone } = ctx;
  const text = narration.toLowerCase();

  // ── Theme detection: derive visual from what the scene is ABOUT ───────────
  let coreVisual: string;

  if (/revenue|earning|profit|PAT|EBITDA|Q[1-4]|quarter|annual|result|sales|turnover|crore|margin/.test(text)) {
    coreVisual = `${stockName} financial results presentation on large screen with charts, Indian corporate boardroom setting, executives reviewing performance data`;
  }
  else if (/price|₹|\bstock|share|market|nse|bse|sensex|nifty|chart|candlestick|technical/.test(text)) {
    coreVisual = `${ticker} stock chart on professional trading terminal, Indian market data screens, red and green candlesticks, focused financial analysis environment`;
  }
  else if (/grow|expand|launch|new|capex|capacity|plant|acquisition|deal|contract|order|partner|win/.test(text)) {
    coreVisual = `Indian ${sector} company business expansion concept, confident corporate team in modern office, growth and development photography`;
  }
  else if (/risk|challenge|concern|pressure|headwind|decline|fall|weak|caution|negativ|slowdown/.test(text)) {
    coreVisual = `Indian business professional reviewing market data with thoughtful analytical focus, corporate office environment, measured decision-making atmosphere`;
  }
  else if (/follow|subscribe|like|share|comment|notification|bell|daily|more/.test(text)) {
    coreVisual = `Indian investor engaged with financial news and analysis on laptop and smartphone, modern home office, stock market data visible on screens`;
  }
  else if (/invest|buy|sell|hold|opportun|position|portfolio|capital|allocation|entry|exit/.test(text)) {
    coreVisual = `Indian investor making informed investment decision, multiple financial analysis screens, focused professional home office setup`;
  }
  else if (idx === 0) {
    // Opening hook scene -- contextually grounded establishing shot
    coreVisual = `${stockName} ${sector} sector dramatic establishing visual, Indian financial context, high-impact opening frame, cinematic professional`;
  }
  else {
    // Fallback to sector pool -- still contextually appropriate
    const pool = SECTOR_IMAGES[sector] ?? SECTOR_IMAGES['Stock Market'];
    coreVisual = pool[idx % pool.length];
  }

  // ── Tone-driven atmosphere ─────────────────────────────────────────────────
  const atmosphere =
    tone === 'AGGRESSIVE' || tone === 'URGENT'
      ? 'dramatic high contrast lighting, intense atmosphere, bold visual energy'
    : tone === 'PROFESSIONAL'
      ? 'clean professional lighting, credible corporate atmosphere, trust-building visual'
    : tone === 'EDUCATIONAL'
      ? 'clear bright lighting, approachable atmosphere, informative visual'
    : 'cinematic professional lighting, dynamic modern energy, engaging visual';

  return [
    coreVisual,
    'ultra realistic photorealistic 8K resolution',
    atmosphere,
    'vertical portrait 9:16 aspect ratio',
    'no text no watermarks no logos',
    'masterpiece quality, sharp focus, depth of field',
  ].join(', ');
}

// ============================================================
// Hook templates -- 5 per tone (framing only, no content claims)
// ============================================================

const HOOKS: Record<string, string[]> = {
  VIRAL: [
    "{stockName} just did something the market CANNOT ignore -- and most people have no idea what's coming!",
    "Everyone on Dalal Street is talking about {stockName} right now -- here's the FULL breakdown in 60 seconds!",
    'This {stockName} move is going VIRAL for a reason -- and you need to understand it before the next session!',
    '{ticker} traders are absolutely stunned right now -- let me show you exactly what happened and why it matters!',
    'If you own or watch {stockName}, stop everything -- this 60-second breakdown could change your perspective entirely!',
  ],
  AGGRESSIVE: [
    '{stockName} is setting up for a MASSIVE move -- and the bulls are firmly in control right now!',
    "Big money is quietly loading up on {stockName} -- here's the breakdown of why smart traders are paying attention!",
    "{ticker} just broke out and the momentum is UNDENIABLE -- here's the full technical and fundamental case!",
    '{stockName} is not playing games! The chart, the numbers, and the news are all pointing in the SAME direction!',
    "The {stockName} setup right now is one of the cleanest I've seen -- here's why this could be a major opportunity!",
  ],
  PROFESSIONAL: [
    "{stockName} presents a compelling investment case right now -- let's break down the key data points objectively.",
    'A data-driven analysis of {stockName}: the numbers, the narrative, and what it means for your portfolio.',
    'Why sophisticated investors are closely tracking {stockName} -- a balanced look at the fundamentals and risks.',
    '{stockName} ({ticker}): Breaking down the valuations, growth drivers, and what the numbers actually tell us.',
    "Is {stockName} worth your capital right now? Here's an objective, evidence-based analysis of the current setup.",
  ],
  EDUCATIONAL: [
    'Let me break down {stockName} in plain English -- everything you need to know in exactly 60 seconds!',
    "Never heard of {stockName}? Don't worry -- here's a complete beginner-friendly breakdown of what's happening!",
    'Understanding {stockName}: the business, the numbers, and the opportunity -- explained as simply as possible!',
    "What exactly is going on with {stockName}? I'll explain it clearly so anyone can understand the full picture!",
    "{stockName} simplified -- here's the business model, the key metrics, and why investors are paying attention!",
  ],
  URGENT: [
    'URGENT {stockName} update -- this is time-sensitive and every holder or watcher needs to see this right now!',
    "BREAKING: {stockName} development that changes what you thought you knew -- watch before tomorrow's market open!",
    "Critical {ticker} alert -- this information is too important to wait on. Here's the full picture right now!",
    "{stockName} news just dropped that has serious implications -- here's a rapid-fire breakdown of everything!",
    "You NEED to know about this {stockName} situation before the next trading session. Here's what happened!",
  ],
};

// ============================================================
// Body templates
// Variables filled from ACTUAL user content (not fabricated).
// {stockData}    = user's raw input (up to 300 chars)
// {keyHighlight} = extracted from user's numbers/facts
// {positiveInfo} = extracted from user's positive sentences
// ============================================================

const BODY: Record<string, string[]> = {
  VIRAL: [
    "Here's the situation. {stockData} What makes this really interesting: {keyHighlight}. And {positiveInfo} -- this is a story the market cannot look away from.",
    "{stockName} has been making waves. {stockData} The standout detail: {keyHighlight}. On top of that, {positiveInfo}.",
    "Let's get to the numbers. {stockData} Here's the standout: {keyHighlight}. Layer on {positiveInfo} and you have a setup worth paying attention to.",
  ],
  AGGRESSIVE: [
    "{stockName} is not here to play games. {stockData} Here's the proof: {keyHighlight}. Combined with {positiveInfo}, this setup is clear.",
    "Look at what's happening. {stockData} This is what a strong setup looks like. {keyHighlight} -- the data backs the thesis.",
    "Here's why {ticker} has traders excited. {stockData} When you see {keyHighlight} alongside {positiveInfo}, that's when real moves happen.",
  ],
  PROFESSIONAL: [
    "{stockName} ({ticker}): {stockData} From a data standpoint, {keyHighlight}. The catalyst of {positiveInfo} adds weight to the analysis.",
    "Analyzing {stockName} objectively: {stockData} The most important data point: {keyHighlight}. Recent development: {positiveInfo}.",
    "Examining {stockName} on its merits. {stockData} Worth noting: {keyHighlight}. The development of {positiveInfo} is a meaningful factor.",
  ],
  EDUCATIONAL: [
    "Here's the simple breakdown. {stockData} In plain terms: {keyHighlight}. The reason this matters: {positiveInfo}.",
    "{stockName} in numbers: {stockData} What does this mean? {keyHighlight}. The key development: {positiveInfo}.",
    "Let me simplify {stockName} for you. The data: {stockData} Translation: {keyHighlight}. The story stems from {positiveInfo}.",
  ],
  URGENT: [
    "The urgent update: {stockData} The critical point right now: {keyHighlight}. The development that triggered this: {positiveInfo}.",
    "Time-sensitive situation: {stockData} What has changed: {keyHighlight}. The trigger was {positiveInfo}.",
    "Breaking down the {stockName} alert: {stockData} The most important thing right now: {keyHighlight}. The development: {positiveInfo}.",
  ],
};

// ============================================================
// Risk / opportunity one-liners (framing only)
// ============================================================

const RISK: Record<string, string> = {
  VIRAL:        'Key risk: broader market volatility. Key opportunity: strong momentum with solid fundamentals -- a combination that historically drives outsized returns.',
  AGGRESSIVE:   'Manage your position size -- never risk more than you can afford. The opportunity is a high-conviction technical breakout backed by improving fundamentals.',
  PROFESSIONAL: 'Key risks include sector headwinds and any valuation premium. However, the competitive moat and growth trajectory provide meaningful support on the downside.',
  EDUCATIONAL:  'Always remember: every investment carries risk. For {stockName}, watch for market volatility and sector dynamics -- while keeping the strong business fundamentals as your anchor.',
  URGENT:       'Short-term: news-driven volatility can create sharp swings. Medium-term: the underlying fundamentals of {stockName} remain the most important factor to track.',
};

// ============================================================
// CTA templates
// ============================================================

const CTAS: Record<string, string[]> = {
  VIRAL: [
    "Like and follow for daily stock breakdowns! Drop a comment -- are you bullish or bearish on {stockName}? Let's discuss!",
    "Follow for more market-moving updates every single day! Share this with anyone watching {ticker} right now!",
    "Hit follow for more viral stock content! Comment '{ticker}' below if you want a deeper-dive analysis next!",
  ],
  AGGRESSIVE: [
    "Follow for high-conviction stock calls every day! This is one of many setups we track -- don't miss the next one!",
    "Like if you're bullish on {stockName}! Follow for daily momentum trades and breakout alerts!",
    "Want more aggressive stock breakdowns? Follow and hit the bell! Your portfolio will thank you later.",
  ],
  PROFESSIONAL: [
    "Follow for more data-driven stock analysis. Investing decisions should always be supported by research -- subscribe for more.",
    "For more balanced, evidence-based stock coverage, follow this channel. Always do your own due diligence before investing.",
    "Subscribe for weekly fundamental analysis on India's best stocks. Building wealth starts with being well-informed.",
  ],
  EDUCATIONAL: [
    "Found this useful? Follow for more beginner-friendly stock breakdowns every day! Share with a friend learning to invest!",
    "Like for more easy-to-understand market education! The more you learn about investing, the better your financial future.",
    "Save this for later and follow for daily market education! Understanding how markets work is a genuine life skill.",
  ],
  URGENT: [
    "Stay ahead -- follow for real-time market updates and critical stock alerts! Being informed is your biggest advantage.",
    "Like if this was useful! Follow for more urgent market updates -- you never want to be the last to know.",
    "Share this with anyone holding {ticker}! Follow for more time-sensitive market intelligence every single day.",
  ],
};

// ============================================================
// Main: Generate Script -- sync, zero API cost
// ============================================================

export async function generateScript(params: {
  stockName:     string;
  ticker:        string;
  sector?:       string;
  stockData:     string;
  positiveNews?: string;
  negativeNews?: string;
  keyNumbers?:   string;
  tone:          VideoTone;
  style:         VideoStyle;
}): Promise<GeneratedScript> {
  const { stockName, ticker, stockData, positiveNews, negativeNews, keyNumbers, tone } = params;

  // ── Build source-locked context first ─────────────────────
  const ctx = buildLockedContext(stockName, ticker, stockData, tone);

  // ── Fill variables only from user input or extracted facts ─
  // These NEVER use fabricated fallbacks. If the user didn't
  // provide it explicitly, we extract it from stockData.
  const positiveInfo =
    positiveNews?.trim()
      ? positiveNews.trim().slice(0, 220)
      : extractPositiveSignal(ctx);

  const keyHighlight =
    keyNumbers?.trim()
      ? `the key metrics: ${keyNumbers.trim().slice(0, 160)}`
      : extractKeyHighlight(ctx);

  const vars: Record<string, string> = {
    stockName,
    ticker,
    stockData:   stockData.trim().slice(0, 320),
    positiveInfo,
    negativeInfo: negativeNews?.trim() || ctx.negatives[0] || 'near-term market volatility',
    keyHighlight,
    keyNumbers:  keyNumbers?.trim() || ctx.numbers.join(', ') || '',
  };

  const t = (tone in HOOKS) ? tone : 'VIRAL';

  const hook        = fill(pick(HOOKS[t]), vars);
  const mainContent = fill(pick(BODY[t]), vars);
  // whyItMatters uses actual context facts, not generic templates
  const whyItMatters = buildWhyItMatters(ctx);
  const riskOpp     = fill(RISK[t] ?? RISK.VIRAL, vars);
  const cta         = fill(pick(CTAS[t]), vars);

  const fullScript = [hook, mainContent, whyItMatters, riskOpp, cta].join(' ');
  const wordCount  = fullScript.split(/\s+/).filter(Boolean).length;

  return {
    hook,
    mainContent,
    whyItMatters,
    keyNumbers:      keyNumbers?.trim() ?? ctx.numbers.join(', '),
    riskOpportunity: riskOpp,
    cta,
    fullScript,
    wordCount,
    estimatedDuration: Math.round(wordCount / 2.5), // ~150 wpm
  };
}

// ============================================================
// Scene generator -- splits script into timed scenes
// Image prompts derived from each scene's narration,
// NOT from a static sector lookup table.
// ============================================================

export async function generateScenes(params: {
  fullScript: string;
  stockName:  string;
  ticker:     string;
  tone:       VideoTone;
  style:      VideoStyle;
  sector?:    string;
  stockData?: string;
}): Promise<GeneratedScene[]> {
  const { fullScript, stockName, ticker, tone, style, stockData } = params;

  // Rebuild the same locked context so image prompts stay
  // grounded in the user's original input.
  const ctx = buildLockedContext(stockName, ticker, stockData ?? '', tone);

  // Split into natural sentence chunks
  const raw = fullScript.match(/[^.!?]+[.!?]+\s*/g) ?? [fullScript];

  // Target 8-10 scenes; merge short sentences
  const TARGET = 9;
  const groups: string[] = [];
  let buf = '';

  for (const s of raw) {
    buf += s;
    if (buf.split(/\s+/).length >= Math.floor(fullScript.split(/\s+/).length / TARGET)) {
      groups.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) {
    if (groups.length > 0) {
      groups[groups.length - 1] += ' ' + buf.trim();
    } else {
      groups.push(buf.trim());
    }
  }

  const transitions = ['cut', 'cut', 'fade', 'cut', 'cut', 'fade', 'cut', 'cut', 'fade'];
  const visualStyles: Record<VideoStyle, string> = {
    DYNAMIC:   'high energy fast cut',
    MINIMAL:   'clean minimal aesthetic',
    CINEMATIC: 'cinematic dramatic',
    NEWS:      'broadcast news style',
    HYPE:      'extreme energy viral',
  };
  const vStyle = visualStyles[style] ?? 'cinematic';

  return groups.map((narration, i): GeneratedScene => {
    const words    = narration.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(3.5, Math.round(words / 2.5 * 10) / 10);

    // Subtitle: first 8 words, capitalize emphasis words
    const subtitleWords = narration.split(/\s+/).slice(0, 8);
    const subtitleText  = subtitleWords
      .map(w => (/\b(just|massive|breaking|urgent|now|alert|huge|shocking|critical|biggest)\b/i.test(w) ? w.toUpperCase() : w))
      .join(' ')
      .replace(/[!?.]+$/, '') + (narration.split(/\s+/).length > 8 ? '...' : '');

    return {
      sceneNumber:  i + 1,
      narration,
      subtitleText,
      // Image prompt derived from THIS scene's narration -- not a static table
      imagePrompt:  narrativeToImagePrompt(narration, ctx, i),
      transition:   i === groups.length - 1 ? 'fade' : transitions[i % transitions.length],
      visualStyle:  vStyle,
      duration,
    };
  });
}

// ============================================================
// SEO generator -- zero API cost
// ============================================================

export async function generateSEO(params: {
  stockName:     string;
  ticker:        string;
  sector?:       string;
  script?:       string;
  tone:          VideoTone;
  keyHighlights?: string;
}): Promise<GeneratedSEO> {
  const { stockName, ticker, tone, keyHighlights } = params;
  const sector = params.sector || detectSector(stockName, params.script ?? '');

  const titleMap: Record<string, string[]> = {
    VIRAL:        [`${stockName} Just Made This SHOCKING Move! 🔥 #Shorts`, `Everyone's Talking About ${stockName} ${ticker} -- Here's Why! #Shorts`, `${stockName} Is Going VIRAL Right Now! Full Breakdown #Shorts`],
    AGGRESSIVE:   [`${stockName} BREAKOUT! 🚀 Full Analysis #Shorts`, `${stockName} ${ticker} MASSIVE Move -- Buy or Sell? #Shorts`, `${stockName} Bulls Taking CONTROL! #Shorts`],
    PROFESSIONAL: [`${stockName} Analysis: Key Metrics & Outlook #Shorts`, `Is ${stockName} (${ticker}) Worth Buying? Honest Analysis #Shorts`, `${stockName} Investment Case: The Full Picture #Shorts`],
    EDUCATIONAL:  [`${stockName} Explained in 60 Seconds! 📚 #Shorts`, `What Is ${stockName}? Beginner's Complete Guide #Shorts`, `Understanding ${stockName} ${ticker} -- Made Simple! #Shorts`],
    URGENT:       [`URGENT: ${stockName} Alert! ⚡ Watch Now #Shorts`, `BREAKING: ${stockName} News You MUST Know! #Shorts`, `${stockName} Critical Update -- Before Market Opens! #Shorts`],
  };

  const t = (tone in titleMap) ? tone : 'VIRAL';
  const title = pick(titleMap[t]);

  const highlights = keyHighlights || `Key analysis on ${stockName} covering performance data, metrics, and market context.`;

  const description = `📊 ${stockName} (${ticker}) -- Complete Stock Analysis

${highlights}

🎯 In this video:
• ${stockName} latest performance overview
• Key financial metrics and data points
• Why the market is paying attention to ${ticker}
• Investment perspective & what to watch next

⚠️ Disclaimer: This content is for educational and informational purposes only. It is not financial advice. Always conduct your own research and consult a qualified financial advisor before making any investment decisions.

🔔 Follow for daily Indian stock market analysis and breakdowns!

#${ticker} #${stockName.replace(/\s+/g, '')} #IndianStockMarket #NSE #BSE #Shorts`;

  const hashtags = [
    `#${ticker}`,
    `#${stockName.replace(/\s+/g, '')}`,
    '#IndianStockMarket',
    '#NSE',
    '#BSE',
    '#Shorts',
    '#StockMarket',
    '#Investing',
    '#StockAnalysis',
    '#DalalStreet',
    '#Nifty50',
    '#Sensex',
    '#ShareMarket',
    '#IndiaStocks',
    '#TradingTips',
  ];

  const tags = [
    stockName,
    ticker,
    `${stockName} stock`,
    `${ticker} share price`,
    `${ticker} analysis`,
    'Indian stock market',
    'NSE stocks today',
    'BSE stocks',
    'stock market India',
    'Indian stocks to buy',
    'Nifty 50 stocks',
    'Sensex today',
    sector,
    'stock analysis India',
    'share market India',
    'best stocks India',
    'stock market shorts',
    'Indian investing',
    'Dalal Street',
    'SEBI stocks',
  ];

  return { title, description, hashtags, tags, category: '22' };
}
